//! Speaker labels for notes: find who spoke when in a note's recording, then
//! transcribe each turn so the note reads "Speaker 1: … / Speaker 2: …" and
//! its summary can say who said or agreed to what.
//!
//! Runs in the background and gives way to dictation between chunks, like
//! the History transcription jobs.

use anyhow::{anyhow, Result};
use log::{info, warn};
use serde::Serialize;
use std::cell::Cell;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

use crate::audio_toolkit::read_wav_samples;
use crate::diarization::{labelled_transcript, speaker_count, speaker_turns};
use crate::managers::history::HistoryManager;
use crate::managers::model::ModelManager;
use crate::managers::notes::NotesManager;
use crate::managers::transcription::{ChunkControl, TranscriptionManager};

/// Progress events for the Notes page: `{ id, state, percent, speakers, error }`.
pub const NOTE_SPEAKERS_EVENT: &str = "note-speakers";

/// Tag on notes whose transcript is labelled by speaker.
pub const SPEAKERS_TAG: &str = "speakers";

/// Shorter recordings rarely have more than one speaker worth labelling.
pub const MIN_SECONDS: f64 = 20.0;

const SAMPLE_RATE: usize = 16_000;
/// Context kept on both sides of a turn so first and last words aren't cut.
const TURN_PAD_MS: i64 = 200;
const DICTATION_POLL: Duration = Duration::from_millis(200);

/// One job at a time: the model is large and the engine is shared.
static RUNNING: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Serialize)]
struct Progress<'a> {
    id: i64,
    state: &'a str,
    percent: u8,
    speakers: usize,
    error: Option<String>,
}

fn emit(app: &AppHandle, progress: Progress) {
    let _ = app.emit(NOTE_SPEAKERS_EVENT, progress);
}

/// Whether the speaker model is downloaded.
pub fn model_ready(app: &AppHandle) -> bool {
    app.state::<Arc<ModelManager>>()
        .speaker_model_path()
        .is_some()
}

/// Labels the speakers in note `id` and re-summarizes it. Returns how many
/// speakers were found; with one, the note is left as it was.
pub async fn label_note_speakers(app: &AppHandle, id: i64) -> Result<usize> {
    if RUNNING.swap(true, Ordering::AcqRel) {
        return Err(anyhow!("Already identifying speakers in another note"));
    }
    let result = run(app, id).await;
    RUNNING.store(false, Ordering::Release);
    match &result {
        Ok(speakers) => emit(
            app,
            Progress {
                id,
                state: "done",
                percent: 100,
                speakers: *speakers,
                error: None,
            },
        ),
        Err(e) => {
            warn!("Speaker labelling failed for note {id}: {e}");
            emit(
                app,
                Progress {
                    id,
                    state: "failed",
                    percent: 0,
                    speakers: 0,
                    error: Some(e.to_string()),
                },
            );
        }
    }
    result
}

async fn run(app: &AppHandle, id: i64) -> Result<usize> {
    let notes = Arc::clone(&app.state::<Arc<NotesManager>>());
    let note = notes
        .get(id)?
        .ok_or_else(|| anyhow!("Note {id} not found"))?;
    let audio_file = note
        .audio_file
        .clone()
        .ok_or_else(|| anyhow!("This note has no recording"))?;
    let model_path = app
        .state::<Arc<ModelManager>>()
        .speaker_model_path()
        .ok_or_else(|| anyhow!("The speaker model isn't downloaded"))?;
    let audio_path = app
        .state::<Arc<HistoryManager>>()
        .get_audio_file_path(&audio_file);

    emit(
        app,
        Progress {
            id,
            state: "running",
            percent: 0,
            speakers: 0,
            error: None,
        },
    );

    let app_for_job = app.clone();
    let original_body = note.body.clone();
    let labelled =
        tauri::async_runtime::spawn_blocking(move || -> Result<Option<(String, usize)>> {
            let samples = read_wav_samples(&audio_path)?;
            let total_ms = (samples.len() * 1000 / SAMPLE_RATE) as i64;
            let segments = crate::diarization::diarize(&model_path, &samples)?;
            let turns = speaker_turns(&segments, total_ms);
            let speakers = speaker_count(&turns);
            info!(
                "Note {id}: {speakers} speaker(s) in {} turn(s)",
                turns.len()
            );
            if speakers < 2 {
                return Ok(None);
            }

            let tm = app_for_job.state::<Arc<TranscriptionManager>>();
            let total_turn_samples: usize = turns
                .iter()
                .map(|t| ((t.end_ms - t.start_ms) as usize) * SAMPLE_RATE / 1000)
                .sum();
            let done_before = Cell::new(0usize);
            let mut texts: Vec<(u32, String)> = Vec::with_capacity(turns.len());
            for turn in &turns {
                let start = ((turn.start_ms - TURN_PAD_MS).max(0) as usize) * SAMPLE_RATE / 1000;
                let end = (((turn.end_ms + TURN_PAD_MS) as usize) * SAMPLE_RATE / 1000)
                    .min(samples.len());
                if start >= end {
                    continue;
                }
                let control = Control {
                    app: &app_for_job,
                    id,
                    done_before: &done_before,
                    total: total_turn_samples.max(1),
                };
                let Some(transcription) =
                    tm.transcribe_in_chunks(samples[start..end].to_vec(), &control)?
                else {
                    return Err(anyhow!("Stopped"));
                };
                done_before.set(done_before.get() + (end - start));
                texts.push((turn.speaker, transcription.text));
            }
            Ok(Some((labelled_transcript(&texts), speakers)))
        })
        .await
        .map_err(|e| anyhow!("Speaker labelling crashed: {e}"))??;

    let Some((body, speakers)) = labelled else {
        return Ok(1);
    };
    if body.trim().is_empty() {
        return Err(anyhow!("No speech found in the recording"));
    }

    // The user may have edited the note meanwhile: never overwrite that.
    let current = notes
        .get(id)?
        .ok_or_else(|| anyhow!("Note {id} was deleted"))?;
    if current.body != original_body {
        return Err(anyhow!(
            "The note was edited while speakers were being identified; it was left unchanged"
        ));
    }
    notes.update(id, &current.title, &body)?;
    // Marks the note as speaker-labelled for the Notes page (renaming).
    let mut tags = current.tags.clone();
    tags.push(SPEAKERS_TAG.to_string());
    notes.set_tags(id, &tags)?;

    // Re-summarize so the summary can attribute points to speakers.
    if let Err(e) = crate::actions::summarize_note(app, id, current.summary_template.clone()).await
    {
        warn!("Summary after speaker labelling failed: {e}");
    }
    Ok(speakers)
}

/// Transcribes note `id` again from its recording (with speaker labels when
/// the speaker model is there and finds several speakers), replacing the
/// transcript, then re-summarizes. For notes transcribed badly before, e.g.
/// in the wrong language.
pub async fn retranscribe_note(app: &AppHandle, id: i64) -> Result<()> {
    if model_ready(app) {
        if let Ok(speakers) = label_note_speakers(app, id).await {
            if speakers >= 2 {
                return Ok(());
            }
        }
    }
    if RUNNING.swap(true, Ordering::AcqRel) {
        return Err(anyhow!("Already transcribing another note"));
    }
    let result = retranscribe_plain(app, id).await;
    RUNNING.store(false, Ordering::Release);
    result
}

async fn retranscribe_plain(app: &AppHandle, id: i64) -> Result<()> {
    let notes = Arc::clone(&app.state::<Arc<NotesManager>>());
    let note = notes
        .get(id)?
        .ok_or_else(|| anyhow!("Note {id} not found"))?;
    let audio_file = note
        .audio_file
        .clone()
        .ok_or_else(|| anyhow!("This note has no recording"))?;
    let audio_path = app
        .state::<Arc<HistoryManager>>()
        .get_audio_file_path(&audio_file);
    let app_for_job = app.clone();
    let text = tauri::async_runtime::spawn_blocking(move || -> Result<String> {
        let samples = read_wav_samples(&audio_path)?;
        let tm = app_for_job.state::<Arc<TranscriptionManager>>();
        let done_before = Cell::new(0usize);
        let control = Control {
            app: &app_for_job,
            id,
            done_before: &done_before,
            total: samples.len().max(1),
        };
        tm.transcribe_in_chunks(samples, &control)?
            .map(|t| t.text)
            .ok_or_else(|| anyhow!("Stopped"))
    })
    .await
    .map_err(|e| anyhow!("Transcription crashed: {e}"))??;
    if text.trim().is_empty() {
        return Err(anyhow!("No speech found in the recording"));
    }
    notes.update(id, &note.title, text.trim())?;
    if let Err(e) = crate::actions::summarize_note(app, id, note.summary_template.clone()).await {
        warn!("Summary after re-transcription failed: {e}");
    }
    Ok(())
}

struct Control<'a> {
    app: &'a AppHandle,
    id: i64,
    /// Samples of earlier turns already transcribed.
    done_before: &'a Cell<usize>,
    total: usize,
}

impl ChunkControl for Control<'_> {
    fn proceed(&self) -> bool {
        // Dictation goes first.
        while crate::tray::dictation_in_progress(self.app) {
            thread::sleep(DICTATION_POLL);
        }
        true
    }

    fn progress(&self, done: usize, _total: usize) {
        let percent = ((self.done_before.get() + done) * 100 / self.total).min(99) as u8;
        emit(
            self.app,
            Progress {
                id: self.id,
                state: "running",
                percent,
                speakers: 0,
                error: None,
            },
        );
    }
}
