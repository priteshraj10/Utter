//! Who spoke when. The speaker model (Sortformer, up to four speakers) finds
//! speaker segments in a recording; [`speaker_turns`] turns them into clean,
//! readable turns that are then transcribed one by one.
//!
//! The model is loaded on CPU only for the run and dropped after: meetings
//! are occasional, and 140 MB shouldn't stay resident for dictation.

use anyhow::{anyhow, Result};
use log::info;
use std::path::Path;
use std::time::Instant;

use transcribe_cpp::{Backend, DiarizeOptions, Model, ModelOptions};

use crate::audio_toolkit::cpu_engine::init_cpu_backends;

/// Labels are decided per frame of this length.
const FRAME_MS: i64 = 100;
/// Silence shorter than this doesn't split one speaker's turn in two.
const JOIN_GAP_MS: i64 = 2_000;
/// Turns shorter than this are a cough, a "yeah" or a mislabel; they join a
/// neighbour instead of breaking the transcript into fragments.
const MIN_TURN_MS: i64 = 1_200;

/// One speaker segment as the model reports it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Segment {
    pub start_ms: i64,
    pub end_ms: i64,
    pub speaker: i32,
    /// The model's confidence; NaN when it gives none.
    pub confidence: f32,
}

/// A stretch of the recording with one speaker, numbered from 1 in order of
/// first appearance.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SpeakerTurn {
    pub speaker: u32,
    pub start_ms: i64,
    pub end_ms: i64,
}

/// Finds speaker segments in 16 kHz mono `pcm` with the model at `path`.
pub fn diarize(path: &Path, pcm: &[f32]) -> Result<Vec<Segment>> {
    init_cpu_backends()?;
    let started = Instant::now();
    let model = Model::load_with(
        path,
        &ModelOptions {
            backend: Backend::Cpu,
            device: None,
        },
    )
    .map_err(|e| anyhow!("Failed to load the speaker model: {e}"))?;
    let mut session = model
        .diarize_session()
        .map_err(|e| anyhow!("Not a speaker model: {e}"))?;
    let segments = session
        .run(pcm, &DiarizeOptions::default())
        .map_err(|e| anyhow!("Speaker detection failed: {e}"))?;
    info!(
        "Found {} speaker segments in {:.0}s of audio in {} ms",
        segments.len(),
        pcm.len() as f64 / 16_000.0,
        started.elapsed().as_millis()
    );
    Ok(segments
        .into_iter()
        .map(|s| Segment {
            start_ms: s.t0_ms,
            end_ms: s.t1_ms,
            speaker: s.speaker_id,
            confidence: s.p,
        })
        .collect())
}

/// Turns raw, possibly overlapping segments over `total_ms` of audio into
/// non-overlapping turns: each moment goes to the most confident speaker,
/// short pauses don't split a turn, and very short turns join a neighbour.
pub fn speaker_turns(segments: &[Segment], total_ms: i64) -> Vec<SpeakerTurn> {
    if total_ms <= 0 {
        return Vec::new();
    }
    let frames = ((total_ms + FRAME_MS - 1) / FRAME_MS) as usize;
    let mut labels: Vec<Option<(i32, f32)>> = vec![None; frames];
    for segment in segments {
        if segment.end_ms <= segment.start_ms {
            continue;
        }
        let confidence = if segment.confidence.is_nan() {
            0.5
        } else {
            segment.confidence
        };
        let first = (segment.start_ms.max(0) / FRAME_MS) as usize;
        let last = ((segment.end_ms + FRAME_MS - 1) / FRAME_MS) as usize;
        for label in labels.iter_mut().take(last.min(frames)).skip(first) {
            if label.is_none_or(|(_, held)| confidence > held) {
                *label = Some((segment.speaker, confidence));
            }
        }
    }

    // Runs of one speaker; silence is left out but bounds the runs.
    let mut runs: Vec<(i32, i64, i64)> = Vec::new();
    for (i, label) in labels.iter().enumerate() {
        let Some((speaker, _)) = label else { continue };
        let start = i as i64 * FRAME_MS;
        let end = (start + FRAME_MS).min(total_ms);
        match runs.last_mut() {
            Some((last, _, last_end)) if *last == *speaker && start - *last_end < JOIN_GAP_MS => {
                *last_end = end;
            }
            _ => runs.push((*speaker, start, end)),
        }
    }

    // Fold short runs into the previous turn (or the next, at the start).
    let mut merged: Vec<(i32, i64, i64)> = Vec::new();
    for run in runs {
        let short = run.2 - run.1 < MIN_TURN_MS;
        match merged.last_mut() {
            Some(last) if short || last.0 == run.0 => last.2 = run.2,
            _ => merged.push(run),
        }
    }
    if merged.len() > 1 && merged[0].2 - merged[0].1 < MIN_TURN_MS {
        let first = merged.remove(0);
        merged[0].1 = first.1;
    }
    // Folding can leave neighbours with the same speaker.
    let mut turns: Vec<(i32, i64, i64)> = Vec::new();
    for run in merged {
        match turns.last_mut() {
            Some(last) if last.0 == run.0 => last.2 = run.2,
            _ => turns.push(run),
        }
    }

    // Number speakers 1, 2, ... in the order they first speak.
    let mut order: Vec<i32> = Vec::new();
    turns
        .into_iter()
        .map(|(speaker, start_ms, end_ms)| {
            let index = order.iter().position(|&s| s == speaker).unwrap_or_else(|| {
                order.push(speaker);
                order.len() - 1
            });
            SpeakerTurn {
                speaker: index as u32 + 1,
                start_ms,
                end_ms,
            }
        })
        .collect()
}

/// How many different speakers `turns` has.
pub fn speaker_count(turns: &[SpeakerTurn]) -> usize {
    let mut seen: Vec<u32> = turns.iter().map(|t| t.speaker).collect();
    seen.sort_unstable();
    seen.dedup();
    seen.len()
}

/// The label a speaker gets in the transcript; users rename it in Notes.
pub fn speaker_label(speaker: u32) -> String {
    format!("Speaker {speaker}")
}

/// The transcript with each turn on its own paragraph, prefixed by its
/// speaker. Consecutive turns of one speaker are joined.
pub fn labelled_transcript(turns: &[(u32, String)]) -> String {
    let mut out: Vec<(u32, String)> = Vec::new();
    for (speaker, text) in turns {
        let text = text.trim();
        if text.is_empty() {
            continue;
        }
        match out.last_mut() {
            Some((last, joined)) if last == speaker => {
                joined.push(' ');
                joined.push_str(text);
            }
            _ => out.push((*speaker, text.to_string())),
        }
    }
    out.into_iter()
        .map(|(speaker, text)| format!("{}: {}", speaker_label(speaker), text))
        .collect::<Vec<_>>()
        .join("\n\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(start_ms: i64, end_ms: i64, speaker: i32) -> Segment {
        Segment {
            start_ms,
            end_ms,
            speaker,
            confidence: f32::NAN,
        }
    }

    #[test]
    fn two_speakers_alternate() {
        let turns = speaker_turns(
            &[
                seg(0, 5_000, 2),
                seg(5_200, 9_000, 1),
                seg(9_500, 14_000, 2),
            ],
            14_000,
        );
        assert_eq!(
            turns,
            vec![
                SpeakerTurn {
                    speaker: 1,
                    start_ms: 0,
                    end_ms: 5_000
                },
                SpeakerTurn {
                    speaker: 2,
                    start_ms: 5_200,
                    end_ms: 9_000
                },
                SpeakerTurn {
                    speaker: 1,
                    start_ms: 9_500,
                    end_ms: 14_000
                },
            ]
        );
        assert_eq!(speaker_count(&turns), 2);
    }

    #[test]
    fn short_pauses_and_interjections_do_not_split_turns() {
        // Speaker 1 pauses for a second, speaker 2 says "yeah" (400 ms).
        let turns = speaker_turns(
            &[seg(0, 4_000, 7), seg(4_300, 4_700, 3), seg(5_000, 9_000, 7)],
            9_000,
        );
        assert_eq!(
            turns,
            vec![SpeakerTurn {
                speaker: 1,
                start_ms: 0,
                end_ms: 9_000
            }]
        );
        assert_eq!(speaker_count(&turns), 1);
    }

    #[test]
    fn overlap_goes_to_the_more_confident_speaker() {
        let a = Segment {
            start_ms: 0,
            end_ms: 6_000,
            speaker: 0,
            confidence: 0.9,
        };
        let b = Segment {
            start_ms: 3_000,
            end_ms: 10_000,
            speaker: 1,
            confidence: 0.6,
        };
        let turns = speaker_turns(&[a, b], 10_000);
        assert_eq!(
            turns,
            vec![
                SpeakerTurn {
                    speaker: 1,
                    start_ms: 0,
                    end_ms: 6_000
                },
                SpeakerTurn {
                    speaker: 2,
                    start_ms: 6_000,
                    end_ms: 10_000
                },
            ]
        );
    }

    #[test]
    fn nothing_in_nothing_out() {
        assert!(speaker_turns(&[], 5_000).is_empty());
        assert!(speaker_turns(&[seg(0, 1_000, 1)], 0).is_empty());
    }

    #[test]
    fn transcript_labels_and_joins_turns() {
        let text = labelled_transcript(&[
            (1, "Hi all.".into()),
            (2, "  ".into()),
            (1, "Let's start.".into()),
            (2, "Sounds good.".into()),
        ]);
        assert_eq!(
            text,
            "Speaker 1: Hi all. Let's start.\n\nSpeaker 2: Sounds good."
        );
    }

    /// Runs the real model. `UTTER_SPEAKER_MODEL=<gguf> UTTER_SPEAKER_WAV=<wav>
    /// cargo test --lib diarization::tests::real_model -- --ignored --nocapture`
    #[test]
    #[ignore = "needs the speaker model and a recording"]
    fn real_model() {
        let model = std::env::var("UTTER_SPEAKER_MODEL").expect("UTTER_SPEAKER_MODEL");
        let wav = std::env::var("UTTER_SPEAKER_WAV").expect("UTTER_SPEAKER_WAV");
        let pcm = crate::audio_toolkit::read_wav_samples(&wav).expect("readable wav");
        let total_ms = (pcm.len() * 1000 / 16_000) as i64;
        let segments = diarize(Path::new(&model), &pcm).expect("diarization runs");
        let turns = speaker_turns(&segments, total_ms);
        println!(
            "{} segments -> {} turns, {} speakers",
            segments.len(),
            turns.len(),
            speaker_count(&turns)
        );
        for t in &turns {
            println!(
                "  Speaker {}: {:.1}s - {:.1}s",
                t.speaker,
                t.start_ms as f64 / 1000.0,
                t.end_ms as f64 / 1000.0
            );
        }
        assert!(turns.windows(2).all(|w| w[0].end_ms <= w[1].start_ms));
    }
}
