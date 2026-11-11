//! Crash-safe recording recovery: continuously journals live audio frames
//! and streaming transcripts to disk during note and meeting recordings.
//!
//! If the system restarts, battery dies, or the application terminates
//! unexpectedly during a 60+ minute meeting, Utter detects the active journal
//! on the next launch and safely recovers both the audio and transcript as a Note.

use std::fs::{self, File, OpenOptions};
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use anyhow::Result;
use chrono::{Local, Utc};
use hound::{SampleFormat, WavSpec, WavWriter};
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

pub const ACTIVE_AUDIO_FILE: &str = "active_recording.raw";
pub const ACTIVE_META_FILE: &str = "active_recording.meta.json";
pub const NOTE_RECOVERED_EVENT: &str = "note-recovered";

const MIN_RECOVERABLE_BYTES: u64 = 32_000; // ~1 second at 16kHz 16-bit mono

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RecoveryMetadata {
    pub started_at: i64,
    pub last_updated: i64,
    pub mode: String,
    pub live_text: String,
    pub template: String,
}

enum JournalCmd {
    Audio(Vec<f32>),
    Text(String),
    Stop { discard: bool },
}

struct JournalSession {
    tx: Sender<JournalCmd>,
    handle: Option<thread::JoinHandle<()>>,
}

static IS_JOURNALING: AtomicBool = AtomicBool::new(false);
static SESSION: Mutex<Option<JournalSession>> = Mutex::new(None);

/// Fast inline check to determine if audio frames should be forwarded to the journal.
#[inline(always)]
pub fn is_journaling() -> bool {
    IS_JOURNALING.load(Ordering::Relaxed)
}

/// Appends a frame of 16kHz mono audio samples to the active recording journal.
pub fn append_audio_frame(frame: &[f32]) {
    if !is_journaling() {
        return;
    }
    if let Ok(guard) = SESSION.lock() {
        if let Some(session) = guard.as_ref() {
            let _ = session.tx.send(JournalCmd::Audio(frame.to_vec()));
        }
    }
}

/// Updates the streaming transcript in the active recording journal.
pub fn update_live_text(committed: &str, tentative: &str) {
    if !is_journaling() {
        return;
    }
    let text = if committed.is_empty() {
        tentative.to_string()
    } else if tentative.is_empty() {
        committed.to_string()
    } else {
        format!("{committed} {tentative}")
    };

    if let Ok(guard) = SESSION.lock() {
        if let Some(session) = guard.as_ref() {
            let _ = session.tx.send(JournalCmd::Text(text));
        }
    }
}

/// Starts an active recording journal for a note or meeting.
pub fn start_session(recordings_dir: PathBuf, mode: &str) {
    // If a session is already active, stop it cleanly first
    finish_session();

    let (tx, rx) = mpsc::channel::<JournalCmd>();
    let dir = recordings_dir.clone();
    let mode_str = mode.to_string();

    let handle = thread::Builder::new()
        .name("utter-journal-worker".into())
        .spawn(move || run_journal_worker(dir, mode_str, rx))
        .ok();

    if let Ok(mut guard) = SESSION.lock() {
        *guard = Some(JournalSession { tx, handle });
        IS_JOURNALING.store(true, Ordering::Release);
        info!(
            "Started crash-safe recording journal in {:?}",
            recordings_dir
        );
    }
}

/// Finishes the journal session normally after recording has been successfully saved.
pub fn finish_session() {
    IS_JOURNALING.store(false, Ordering::Release);
    let session = {
        if let Ok(mut guard) = SESSION.lock() {
            guard.take()
        } else {
            None
        }
    };

    if let Some(s) = session {
        let _ = s.tx.send(JournalCmd::Stop { discard: true });
        if let Some(handle) = s.handle {
            let _ = handle.join();
        }
    }
}

/// Discards the journal session when a user cancels the recording.
pub fn discard_session() {
    finish_session();
}

/// The dedicated background thread that continuously flushes audio and metadata to disk.
fn run_journal_worker(recordings_dir: PathBuf, mode: String, rx: Receiver<JournalCmd>) {
    let _ = fs::create_dir_all(&recordings_dir);
    let raw_path = recordings_dir.join(ACTIVE_AUDIO_FILE);
    let meta_path = recordings_dir.join(ACTIVE_META_FILE);

    let raw_file = match OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&raw_path)
    {
        Ok(f) => f,
        Err(e) => {
            error!(
                "Failed to create recording journal file {:?}: {e}",
                raw_path
            );
            return;
        }
    };

    let mut writer = BufWriter::with_capacity(64 * 1024, raw_file);
    let now = Utc::now().timestamp();
    let mut meta = RecoveryMetadata {
        started_at: now,
        last_updated: now,
        mode,
        live_text: String::new(),
        template: "meeting".to_string(),
    };

    // Save initial metadata snapshot
    save_meta_snapshot(&meta_path, &meta);

    let mut samples_since_flush: usize = 0;
    let mut last_meta_save = Instant::now();

    while let Ok(cmd) = rx.recv() {
        match cmd {
            JournalCmd::Audio(samples) => {
                for &s in &samples {
                    let sample_i16 = (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
                    if writer.write_all(&sample_i16.to_le_bytes()).is_err() {
                        break;
                    }
                }
                samples_since_flush += samples.len();

                // Flush every 16,000 samples (~1 second) to guarantee OS persistence
                if samples_since_flush >= 16_000 {
                    let _ = writer.flush();
                    samples_since_flush = 0;
                }
            }
            JournalCmd::Text(text) => {
                meta.live_text = text;
                meta.last_updated = Utc::now().timestamp();

                // Periodic metadata snapshot every 3 seconds
                if last_meta_save.elapsed() >= Duration::from_secs(3) {
                    save_meta_snapshot(&meta_path, &meta);
                    last_meta_save = Instant::now();
                }
            }
            JournalCmd::Stop { discard } => {
                let _ = writer.flush();
                drop(writer);

                if discard {
                    let _ = fs::remove_file(&raw_path);
                    let _ = fs::remove_file(&meta_path);
                }
                break;
            }
        }
    }
}

fn save_meta_snapshot(meta_path: &Path, meta: &RecoveryMetadata) {
    if let Ok(json) = serde_json::to_string_pretty(meta) {
        let tmp_path = meta_path.with_extension("tmp");
        if fs::write(&tmp_path, json).is_ok() {
            let _ = fs::rename(tmp_path, meta_path);
        }
    }
}

/// Checks for orphaned recording journals on application startup and recovers them as Notes.
pub fn check_and_recover(app: &AppHandle) {
    let app_data_dir = match crate::portable::app_data_dir(app) {
        Ok(dir) => dir,
        Err(e) => {
            warn!("Could not determine app data dir for crash recovery: {e}");
            return;
        }
    };

    let recordings_dir = app_data_dir.join("recordings");
    let raw_path = recordings_dir.join(ACTIVE_AUDIO_FILE);
    let meta_path = recordings_dir.join(ACTIVE_META_FILE);

    if !raw_path.exists() {
        return;
    }

    let file_size = match fs::metadata(&raw_path) {
        Ok(m) => m.len(),
        Err(e) => {
            warn!("Could not read journal metadata: {e}");
            return;
        }
    };

    // Load metadata if available
    let meta: Option<RecoveryMetadata> = fs::read_to_string(&meta_path)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok());

    let has_meaningful_text = meta
        .as_ref()
        .map(|m| m.live_text.trim().split_whitespace().count() >= 3)
        .unwrap_or(false);

    if file_size < MIN_RECOVERABLE_BYTES && !has_meaningful_text {
        info!(
            "Discarding negligible orphaned journal ({} bytes)",
            file_size
        );
        let _ = fs::remove_file(&raw_path);
        let _ = fs::remove_file(&meta_path);
        return;
    }

    let sample_count = file_size / 2;
    let audio_seconds = sample_count as f64 / 16000.0;
    info!(
        "Found interrupted recording journal ({:.1}s audio, {} bytes). Recovering...",
        audio_seconds, file_size
    );

    // Convert raw PCM to a valid WAV file
    let wav_file_name = format!("recovered-{}.wav", Utc::now().timestamp());
    let wav_path = recordings_dir.join(&wav_file_name);

    if let Err(e) = convert_raw_pcm_to_wav(&raw_path, &wav_path) {
        error!("Failed to convert journal PCM to WAV: {e}");
        return;
    }

    // Prepare note content
    let now_str = Local::now().format("%b %-d, %-I:%M %p").to_string();
    let title = format!("Recovered Note ({})", now_str);
    let body = meta
        .as_ref()
        .map(|m| m.live_text.trim().to_string())
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| {
            format!(
                "Audio recovered from an interrupted session ({:.0} seconds).",
                audio_seconds
            )
        });

    let template = meta
        .as_ref()
        .map(|m| m.template.clone())
        .unwrap_or_else(|| "meeting".to_string());

    // Clean up temporary journal files before inserting note to prevent duplicate recovery
    let _ = fs::remove_file(&raw_path);
    let _ = fs::remove_file(&meta_path);

    // Create the note in NotesManager
    let notes = app.state::<std::sync::Arc<crate::managers::notes::NotesManager>>();
    let note = match notes.create(&title, &body, Some(wav_file_name), audio_seconds, "meeting") {
        Ok(n) => n,
        Err(e) => {
            error!("Failed to create recovered note: {e}");
            return;
        }
    };

    let _ = notes.set_tags(note.id, &["Recovered".to_string()]);

    info!(
        "Successfully recovered interrupted recording into note #{} ('{}')",
        note.id, note.title
    );

    // Emit event so frontend can notify the user
    let _ = app.emit(
        NOTE_RECOVERED_EVENT,
        serde_json::json!({
            "id": note.id,
            "title": note.title,
            "audio_seconds": audio_seconds,
        }),
    );

    // Automatically trigger AI summary in background if there's enough text
    let word_count = body.split_whitespace().count();
    if word_count >= 5 {
        let app_handle = app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = crate::actions::summarize_note(&app_handle, note.id, Some(template)).await;
        });
    }
}

/// Converts raw 16-bit 16kHz mono PCM samples into a standard RIFF WAV file.
fn convert_raw_pcm_to_wav(raw_path: &Path, wav_path: &Path) -> Result<()> {
    let file = File::open(raw_path)?;
    let mut reader = BufReader::new(file);

    let spec = WavSpec {
        channels: 1,
        sample_rate: 16000,
        bits_per_sample: 16,
        sample_format: SampleFormat::Int,
    };

    let mut writer = WavWriter::create(wav_path, spec)?;
    let mut buf = [0u8; 4096];

    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 {
            break;
        }
        let samples = n / 2;
        for i in 0..samples {
            let sample = i16::from_le_bytes([buf[i * 2], buf[i * 2 + 1]]);
            writer.write_sample(sample)?;
        }
    }

    writer.finalize()?;
    Ok(())
}
