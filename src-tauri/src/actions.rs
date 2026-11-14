#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
use crate::apple_intelligence;
use crate::audio_feedback::{play_feedback_sound, play_feedback_sound_blocking, SoundType};
use crate::audio_toolkit::VadPolicy;
use crate::managers::audio::{recording_error_type, AudioRecordingManager};
use crate::managers::history::HistoryManager;
use crate::managers::model::ModelManager;
use crate::managers::transcription::policy::{live_decode, LiveDecode, ModelTraits};
use crate::managers::transcription::StreamWorkKind;
use crate::managers::transcription::{Transcription, TranscriptionManager};
use crate::settings::{get_settings, AppSettings, OverlayStyle, APPLE_INTELLIGENCE_PROVIDER_ID};
use crate::shortcut;
use crate::tray::{set_tray_state, TrayIconState};
use crate::utils::{
    self, show_processing_overlay, show_recording_overlay, show_transcribing_overlay,
};
use crate::TranscriptionCoordinator;
use log::{debug, error, info, warn};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;
use std::future::Future;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::Manager;
use tauri::{AppHandle, Emitter};
use tauri_specta::Event;

/// How a dictation ended.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum TranscriptionOutcome {
    /// The text was typed.
    Typed,
    /// Nothing was heard, so nothing was typed.
    Empty,
    /// The microphone sent only digital silence (e.g. muted).
    Silent,
    /// Transcribing or pasting failed.
    Failed,
}

/// Emitted when a dictation finishes (not on cancel); onboarding uses it to measure speed.
#[derive(Clone, Debug, Serialize, Deserialize, Type, tauri_specta::Event)]
pub struct TranscriptionCompleteEvent {
    pub outcome: TranscriptionOutcome,
    pub audio_seconds: f64,
    pub wait_seconds: f64,
}

fn emit_transcription_complete(
    app: &AppHandle,
    outcome: TranscriptionOutcome,
    sample_count: usize,
    stop_time: Instant,
) {
    let event = TranscriptionCompleteEvent {
        outcome,
        audio_seconds: sample_count as f64
            / crate::audio_toolkit::constants::WHISPER_SAMPLE_RATE as f64,
        wait_seconds: stop_time.elapsed().as_secs_f64(),
    };
    if let Err(e) = event.emit(app) {
        warn!("Failed to emit transcription complete: {e}");
    }
}

/// Nothing to type: `Silent` if the microphone sent only zeros, else `Empty`.
fn empty_outcome(input_silent: bool) -> TranscriptionOutcome {
    if input_silent {
        TranscriptionOutcome::Silent
    } else {
        TranscriptionOutcome::Empty
    }
}

const CANCELLATION_POLL_INTERVAL: Duration = Duration::from_millis(25);

/// Bumped per recording session, so a late paste from an earlier session
/// doesn't reset the tray or hide the overlay of a newer one.
static RECORDING_SESSION: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, serde::Serialize)]
struct RecordingErrorEvent {
    error_type: String,
    detail: Option<String>,
}

/// Drop guard that finishes the transcription pipeline, including immediate
/// model unloading on early exits.
struct FinishGuard(AppHandle, Arc<TranscriptionManager>);
impl Drop for FinishGuard {
    fn drop(&mut self) {
        self.1.maybe_unload_immediately("transcription session");
        if let Some(c) = self.0.try_state::<TranscriptionCoordinator>() {
            c.notify_processing_finished();
        }
        // The pipeline just freed its large transient buffers (captured PCM,
        // WAV copy, engine scratch); hand the cached pages back to the OS so
        // they don't sit in malloc arenas until they get swapped out (#1792).
        crate::memory::trim_freed_memory();
    }
}

// Shortcut Action Trait
pub trait ShortcutAction: Send + Sync {
    fn start(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str);
    fn stop(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str);
}

/// What a recording is for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DictationMode {
    /// Type the transcript into the focused app.
    Dictate,
    /// Treat the transcript as an instruction for the selected text.
    Command,
    /// Save the transcript as a note instead of typing it.
    Note,
}

impl DictationMode {
    fn usage_label(self) -> &'static str {
        match self {
            DictationMode::Dictate => "dictate",
            DictationMode::Command => "command",
            DictationMode::Note => "note",
        }
    }
}

// Transcribe Action
struct TranscribeAction {
    post_process: bool,
    mode: DictationMode,
}

/// Event sent with `{ id, title }` when a recording is saved as a note.
const NOTE_SAVED_EVENT: &str = "note-saved";

/// Saves a voice note or meeting and summarizes it in the background with auto-detected classification.
fn save_voice_note(
    app: &AppHandle,
    text: &str,
    audio_file: Option<String>,
    audio_seconds: f64,
    forced_template: Option<String>,
    custom_tags: Option<Vec<String>>,
) {
    let notes = app.state::<Arc<crate::managers::notes::NotesManager>>();
    let settings = get_settings(app);
    let text = if settings.voice_commands {
        crate::utter::apply_voice_commands(text)
    } else {
        text.to_string()
    };

    let screen_ctx = crate::utter::dictation_screen_context();
    let classification =
        crate::utter::classify_recording(&text, audio_seconds, screen_ctx.as_ref());

    let template = forced_template.unwrap_or(classification.template);
    let note = match notes.create(
        &classification.title,
        &text,
        audio_file,
        audio_seconds,
        &classification.kind,
    ) {
        Ok(note) => note,
        Err(e) => {
            error!("Failed to save voice note: {e}");
            let _ = app.emit(
                "transcription-error",
                format!("Could not save the note: {e}"),
            );
            return;
        }
    };

    let tags = custom_tags.unwrap_or(classification.tags);
    if !tags.is_empty() {
        let _ = notes.set_tags(note.id, &tags);
    }

    // Say where the words went, so a note never appears (or seems missing)
    // without the user knowing.
    let _ = app.emit(
        NOTE_SAVED_EVENT,
        serde_json::json!({ "id": note.id, "title": note.title }),
    );

    // Long recordings with several people get speaker labels first (which
    // re-summarizes); everything else, or a single speaker, is summarized now.
    let word_count = text.split_whitespace().count();
    let label_speakers = note.audio_file.is_some()
        && audio_seconds >= crate::speakers::MIN_SECONDS
        && crate::speakers::model_ready(app);
    if word_count >= 5 || label_speakers {
        let app = app.clone();
        let template_clone = template.clone();
        tauri::async_runtime::spawn(async move {
            if label_speakers {
                match crate::speakers::label_note_speakers(&app, note.id).await {
                    Ok(speakers) if speakers >= 2 => return,
                    Ok(_) => {}
                    Err(e) => warn!("Speaker labelling skipped: {e}"),
                }
            }
            if let Err(e) = summarize_note(&app, note.id, Some(template_clone)).await {
                warn!("Automatic note summary failed: {e}");
            }
        });
    }
}

/// Writes a summary for note `id` with `template` (see
/// [`crate::utter::SUMMARY_TEMPLATES`]; `None` picks the note's default) and
/// stores it. Uses configured cloud LLM, Apple Intelligence on macOS, or
/// built-in on-device local intelligence engine.
pub(crate) async fn summarize_note(
    app: &AppHandle,
    id: i64,
    template: Option<String>,
) -> Result<String, String> {
    let notes = Arc::clone(&app.state::<Arc<crate::managers::notes::NotesManager>>());
    let note = notes
        .get(id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Note {id} not found"))?;
    if note.body.trim().is_empty() {
        return Err("This note is empty".into());
    }
    let settings = get_settings(app);
    let template = template
        .filter(|t| crate::utter::SUMMARY_TEMPLATES.contains(&t.as_str()))
        .unwrap_or_else(|| crate::utter::default_summary_template(&note.kind).to_string());
    let prompt = crate::utter::summary_prompt(&template);

    // 1. Try configured LLM provider
    let mut summary = run_llm_prompt(&settings, &note.body, &prompt).await;

    // 2. Try Apple Intelligence on macOS
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    if summary.is_none() && apple_intelligence::check_apple_intelligence_availability() {
        let system_prompt = build_system_prompt(&prompt);
        if let Ok(res) =
            apple_intelligence::process_text_with_system_prompt(&system_prompt, &note.body, 0)
        {
            if !res.trim().is_empty() {
                summary = Some(strip_invisible_chars(&res));
            }
        }
    }

    // 3. Fall back to local on-device intelligent summarizer
    let summary =
        summary.unwrap_or_else(|| crate::utter::local_summarize_note(&note.body, &template));

    notes
        .set_summary(id, Some(summary.trim()), Some(&template))
        .map_err(|e| e.to_string())?;

    if crate::utter::is_auto_title(&note.title, &note.body) {
        let excerpt: String = note.body.chars().take(4_000).collect();
        let title = if let Some(t) =
            run_llm_prompt(&settings, &excerpt, crate::utter::NOTE_TITLE_PROMPT)
                .await
                .as_deref()
                .and_then(crate::utter::clean_ai_title)
        {
            Some(t)
        } else {
            Some(crate::utter::smart_note_title(&note.body))
        };
        if let Some(title) = title {
            let still_auto = notes
                .get(id)
                .ok()
                .flatten()
                .is_some_and(|n| crate::utter::is_auto_title(&n.title, &n.body));
            if still_auto {
                if let Err(e) = notes.set_title(id, &title) {
                    warn!("Could not store note title: {e}");
                }
            }
        }
    }
    Ok(summary)
}

/// An answer from Ask-your-notes and the notes it drew on.
#[derive(Clone, Debug, serde::Serialize, specta::Type)]
pub struct NotesAnswer {
    pub answer: String,
    /// `(id, title)` of the notes cited, or of every note consulted when the
    /// answer cites none.
    pub sources: Vec<NoteSource>,
}

#[derive(Clone, Debug, serde::Serialize, specta::Type)]
pub struct NoteSource {
    pub id: i64,
    pub title: String,
}

/// Answers `question` from the user's notes.
pub(crate) async fn ask_notes(
    app: &AppHandle,
    question: &str,
    history: &[crate::utter::ChatExchange],
) -> Result<NotesAnswer, String> {
    if question.trim().is_empty() {
        return Err("Ask a question first".into());
    }
    let settings = get_settings(app);
    let notes = app
        .state::<Arc<crate::managers::notes::NotesManager>>()
        .list(None)
        .map_err(|e| e.to_string())?;
    if notes.is_empty() {
        return Err("You have no notes yet".into());
    }
    let contexts: Vec<crate::utter::NoteContext<'_>> = notes
        .iter()
        .map(|n| crate::utter::NoteContext {
            id: n.id,
            title: &n.title,
            body: &n.body,
            summary: n.summary.as_deref(),
            tags: &n.tags,
            created_at: n.created_at,
        })
        .collect();
    let picked: Vec<&crate::utter::NoteContext<'_>> =
        crate::utter::rank_notes(question, &contexts, 6)
            .into_iter()
            .map(|i| &contexts[i])
            .collect();
    let prompt = crate::utter::ask_notes_prompt_with_history(&picked, history);
    let mut answer = run_llm_prompt(&settings, question.trim(), &prompt).await;

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    if answer.is_none() && apple_intelligence::check_apple_intelligence_availability() {
        let system_prompt = build_system_prompt(&prompt);
        if let Ok(res) =
            apple_intelligence::process_text_with_system_prompt(&system_prompt, question.trim(), 0)
        {
            if !res.trim().is_empty() {
                answer = Some(strip_invisible_chars(&res));
            }
        }
    }

    if let Some(ans) = answer {
        let cited = crate::utter::cited_note_ids(&ans);
        let sources = picked
            .iter()
            .filter(|n| cited.is_empty() || cited.contains(&n.id))
            .map(|n| NoteSource {
                id: n.id,
                title: n.title.to_string(),
            })
            .collect();
        Ok(NotesAnswer {
            answer: ans.trim().to_string(),
            sources,
        })
    } else {
        let (ans, cited_ids) = crate::utter::local_ask_notes(question.trim(), &picked, history);
        let sources = picked
            .iter()
            .filter(|n| cited_ids.is_empty() || cited_ids.contains(&n.id))
            .map(|n| NoteSource {
                id: n.id,
                title: n.title.to_string(),
            })
            .collect();
        Ok(NotesAnswer {
            answer: ans,
            sources,
        })
    }
}

/// Builds today's digest note from everything dictated and noted since local
/// midnight, and returns it.
pub(crate) async fn create_daily_digest(
    app: &AppHandle,
) -> Result<crate::managers::notes::Note, String> {
    use crate::managers::notes::kind;
    let settings = get_settings(app);
    let now = chrono::Local::now();
    let midnight = now
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .and_then(|t| t.and_local_timezone(chrono::Local).earliest())
        .map(|t| t.timestamp())
        .unwrap_or_else(|| now.timestamp() - 86_400);
    let time_of = |ts: i64| {
        chrono::DateTime::from_timestamp(ts, 0)
            .map(|d| d.with_timezone(&chrono::Local).format("%H:%M").to_string())
            .unwrap_or_default()
    };

    let mut log = String::new();
    let entries = app
        .state::<Arc<HistoryManager>>()
        .entries_since(midnight)
        .map_err(|e| e.to_string())?;
    for entry in &entries {
        let text = entry
            .post_processed_text
            .as_deref()
            .unwrap_or(&entry.transcription_text);
        log.push_str(&format!(
            "[{}] (dictation) {}\n",
            time_of(entry.timestamp),
            text.trim()
        ));
    }
    let notes_manager = Arc::clone(&app.state::<Arc<crate::managers::notes::NotesManager>>());
    let notes = notes_manager
        .changed_since(midnight)
        .map_err(|e| e.to_string())?;
    for note in notes.iter().filter(|n| n.kind != kind::DIGEST) {
        let content = note.summary.as_deref().unwrap_or(&note.body);
        log.push_str(&format!(
            "[{}] (note: {}) {}\n",
            time_of(note.created_at),
            note.title,
            content.trim()
        ));
    }
    if log.trim().is_empty() {
        if let Ok(all_notes) = notes_manager.list(None) {
            for note in all_notes.iter().filter(|n| n.kind != kind::DIGEST).take(5) {
                let content = note.summary.as_deref().unwrap_or(&note.body);
                log.push_str(&format!(
                    "[{}] (note: {}) {}\n",
                    time_of(note.created_at),
                    note.title,
                    content.trim()
                ));
            }
        }
    }
    if log.trim().is_empty() {
        return Err("Nothing dictated or noted yet. Create a note or dictate first!".into());
    }
    // Keep the request a sensible size on very busy days.
    let log: String = log
        .chars()
        .rev()
        .take(60_000)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();

    let mut digest = run_llm_prompt(&settings, &log, crate::utter::DAILY_DIGEST_PROMPT).await;

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    if digest.is_none() && apple_intelligence::check_apple_intelligence_availability() {
        let system_prompt = build_system_prompt(crate::utter::DAILY_DIGEST_PROMPT);
        if let Ok(res) =
            apple_intelligence::process_text_with_system_prompt(&system_prompt, &log, 0)
        {
            if !res.trim().is_empty() {
                digest = Some(strip_invisible_chars(&res));
            }
        }
    }

    let digest = digest.unwrap_or_else(|| crate::utter::local_daily_digest(&log));
    let title = format!("Daily digest · {}", now.format("%a %d %b %Y"));
    let note = notes_manager
        .create(&title, log.trim(), None, 0.0, kind::DIGEST)
        .map_err(|e| e.to_string())?;
    notes_manager
        .set_summary(note.id, Some(digest.trim()), Some("digest"))
        .map_err(|e| e.to_string())?;
    notes_manager
        .get(note.id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "The digest note vanished".to_string())
}

/// Field name for structured output JSON schema
const TRANSCRIPTION_FIELD: &str = "transcription";

/// Strip invisible Unicode characters that some LLMs may insert
fn strip_invisible_chars(s: &str) -> String {
    s.replace(['\u{200B}', '\u{200C}', '\u{200D}', '\u{FEFF}'], "")
}

/// Strip a leading `<think>...</think>` block. Some endpoints can't disable
/// reasoning, and some local servers put the reasoning text into `content`
/// instead of a separate field — without this the user would get the model's
/// chain of thought pasted along with the cleaned transcription.
fn strip_think_block(s: &str) -> &str {
    if let Some(rest) = s.trim_start().strip_prefix("<think>") {
        if let Some(end) = rest.find("</think>") {
            return rest[end + "</think>".len()..].trim_start();
        }
    }
    s
}

/// Build a system prompt from the user's prompt template.
/// Removes `${output}` placeholder since the transcription is sent as the user message.
fn build_system_prompt(prompt_template: &str) -> String {
    prompt_template.replace("${output}", "").trim().to_string()
}

/// Returns `true` when a transcription has no meaningful content to
/// post-process (empty or whitespace-only). Used to skip the post-processing
/// LLM call when nothing was actually transcribed, which would otherwise make
/// the model reply with an error message such as "you need to provide the
/// transcription".
fn is_blank_transcription(transcription: &str) -> bool {
    transcription.trim().is_empty()
}

async fn complete_unless_cancelled<F, C>(operation: F, is_cancelled: C) -> Option<F::Output>
where
    F: Future,
    C: Fn() -> bool,
{
    tokio::pin!(operation);

    loop {
        if is_cancelled() {
            return None;
        }

        if let Ok(result) =
            tokio::time::timeout(CANCELLATION_POLL_INTERVAL, operation.as_mut()).await
        {
            return Some(result);
        }
    }
}

#[allow(dead_code)]
fn should_use_streaming_overlay(style: OverlayStyle, is_streaming: bool) -> bool {
    style == OverlayStyle::Live && is_streaming
}

/// The prompt AI cleanup uses: the frontmost app's style when one matches,
/// otherwise the selected prompt. Returns `(prompt_id, prompt_text)`.
fn resolve_cleanup_prompt(
    settings: &AppSettings,
    front_app: Option<&crate::utter::FrontApp>,
) -> Option<(String, String)> {
    let style_prompt_id = front_app
        .and_then(|app| crate::utter::app_style_for(&settings.app_styles, app))
        .map(|style| style.prompt_id.clone());
    if let Some(id) = &style_prompt_id {
        debug!("Using per-app style prompt '{}'", id);
    }
    let prompt_id =
        match style_prompt_id.or_else(|| settings.post_process_selected_prompt_id.clone()) {
            Some(id) => id,
            None => {
                debug!("Post-processing skipped because no prompt is selected");
                return None;
            }
        };
    match settings
        .post_process_prompts
        .iter()
        .find(|p| p.id == prompt_id)
    {
        Some(prompt) => Some((prompt.id.clone(), prompt.prompt.clone())),
        None => {
            debug!(
                "Post-processing skipped because prompt '{}' was not found",
                prompt_id
            );
            None
        }
    }
}

async fn post_process_transcription(
    settings: &AppSettings,
    transcription: &str,
    front_app: Option<&crate::utter::FrontApp>,
    screen_ctx: Option<&crate::utter::ScreenContext>,
) -> Option<String> {
    if is_blank_transcription(transcription) {
        debug!("Post-processing skipped because the transcription is empty");
        return None;
    }
    let (prompt_id, prompt) = resolve_cleanup_prompt(settings, front_app)
        .unwrap_or_else(|| ("default_improve_transcriptions".to_string(), "".to_string()));
    let contextual_prompt = crate::utter::inject_app_context(
        &prompt,
        front_app,
        if settings.context_awareness {
            screen_ctx
        } else {
            None
        },
    );
    // Provider only: a local model on every dictation would slow typing down.
    let mut res = run_provider_prompt(settings, transcription, &contextual_prompt).await;

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    if res.is_none() && apple_intelligence::check_apple_intelligence_availability() {
        let system_prompt = build_system_prompt(&contextual_prompt);
        if let Ok(apple_res) =
            apple_intelligence::process_text_with_system_prompt(&system_prompt, transcription, 0)
        {
            if !apple_res.trim().is_empty() {
                res = Some(strip_invisible_chars(&apple_res));
            }
        }
    }

    if res.is_none() {
        res = Some(crate::utter::local_transform_text(
            transcription,
            &prompt_id,
        ));
    }
    res
}

/// Sends `input` through the configured post-processing provider with
/// `prompt` (a template that may contain `${output}`). Used by AI cleanup,
/// command mode and note summaries.
/// Runs `prompt` over `input` with the configured provider, or else the
/// local AI (Ollama) when one is running. `None` when neither answers; the
/// caller then falls back to Apple Intelligence or built-in rules.
pub(crate) async fn run_llm_prompt(
    settings: &AppSettings,
    input: &str,
    prompt: &str,
) -> Option<String> {
    if let Some(result) = run_provider_prompt(settings, input, prompt).await {
        return Some(result);
    }
    if prompt.trim().is_empty() || input.trim().is_empty() {
        return None;
    }
    crate::local_llm::chat(&build_system_prompt(prompt), input)
        .await
        .map(|text| strip_invisible_chars(&text))
}

/// Runs `prompt` with the configured provider only.
async fn run_provider_prompt(settings: &AppSettings, input: &str, prompt: &str) -> Option<String> {
    let transcription = input;
    let prompt = prompt.to_string();

    let provider = match settings.active_post_process_provider().cloned() {
        Some(provider) => provider,
        None => {
            debug!("Post-processing enabled but no provider is selected");
            return None;
        }
    };

    let model = settings
        .post_process_models
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    if model.trim().is_empty() {
        debug!(
            "Post-processing skipped because provider '{}' has no model configured",
            provider.id
        );
        return None;
    }

    if prompt.trim().is_empty() {
        debug!("Post-processing skipped because the selected prompt is empty");
        return None;
    }

    debug!(
        "Starting LLM post-processing with provider '{}' (model: {})",
        provider.id, model
    );

    let api_key = settings
        .post_process_api_keys
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    // Ask these providers to skip reasoning/thinking — post-processing rarely
    // benefits from it and it adds seconds of latency. llm_client picks the
    // field the endpoint understands and retries without it if rejected.
    let disable_reasoning = matches!(provider.id.as_str(), "custom" | "openrouter");

    if provider.supports_structured_output {
        debug!("Using structured outputs for provider '{}'", provider.id);

        let system_prompt = build_system_prompt(&prompt);
        let user_content = transcription.to_string();

        // Handle Apple Intelligence separately since it uses native Swift APIs
        if provider.id == APPLE_INTELLIGENCE_PROVIDER_ID {
            #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
            {
                if !apple_intelligence::check_apple_intelligence_availability() {
                    debug!(
                        "Apple Intelligence selected but not currently available on this device"
                    );
                    return None;
                }

                let token_limit = model.trim().parse::<i32>().unwrap_or(0);
                return match apple_intelligence::process_text_with_system_prompt(
                    &system_prompt,
                    &user_content,
                    token_limit,
                ) {
                    Ok(result) => {
                        if result.trim().is_empty() {
                            debug!("Apple Intelligence returned an empty response");
                            None
                        } else {
                            let result = strip_invisible_chars(&result);
                            debug!(
                                "Apple Intelligence post-processing succeeded. Output length: {} chars",
                                result.len()
                            );
                            Some(result)
                        }
                    }
                    Err(err) => {
                        error!("Apple Intelligence post-processing failed: {}", err);
                        None
                    }
                };
            }

            #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
            {
                debug!("Apple Intelligence provider selected on unsupported platform");
                return None;
            }
        }

        // Define JSON schema for transcription output
        let json_schema = serde_json::json!({
            "type": "object",
            "properties": {
                (TRANSCRIPTION_FIELD): {
                    "type": "string",
                    "description": "The cleaned and processed transcription text"
                }
            },
            "required": [TRANSCRIPTION_FIELD],
            "additionalProperties": false
        });

        match crate::llm_client::send_chat_completion_with_schema(
            &provider,
            api_key.clone(),
            &model,
            user_content,
            Some(system_prompt),
            Some(json_schema),
            disable_reasoning,
        )
        .await
        {
            Ok(Some(content)) => {
                // Parse the JSON response to extract the transcription field
                let content = strip_think_block(&content);
                match serde_json::from_str::<serde_json::Value>(content) {
                    Ok(json) => {
                        if let Some(transcription_value) =
                            json.get(TRANSCRIPTION_FIELD).and_then(|t| t.as_str())
                        {
                            let result = strip_invisible_chars(transcription_value);
                            debug!(
                                "Structured output post-processing succeeded for provider '{}'. Output length: {} chars",
                                provider.id,
                                result.len()
                            );
                            return Some(result);
                        } else {
                            error!("Structured output response missing 'transcription' field");
                            return Some(strip_invisible_chars(content));
                        }
                    }
                    Err(e) => {
                        error!(
                            "Failed to parse structured output JSON: {}. Returning raw content.",
                            e
                        );
                        return Some(strip_invisible_chars(content));
                    }
                }
            }
            Ok(None) => {
                error!("LLM API response has no content");
                return None;
            }
            Err(e) => {
                warn!(
                    "Structured output failed for provider '{}': {}. Falling back to legacy mode.",
                    provider.id, e
                );
                // Fall through to legacy mode below
            }
        }
    }

    // Legacy mode: Replace ${output} variable in the prompt with the actual text
    let processed_prompt = prompt.replace("${output}", transcription);
    debug!("Processed prompt length: {} chars", processed_prompt.len());

    match crate::llm_client::send_chat_completion(
        &provider,
        api_key,
        &model,
        processed_prompt,
        disable_reasoning,
    )
    .await
    {
        Ok(Some(content)) => {
            let content = strip_invisible_chars(strip_think_block(&content));
            debug!(
                "LLM post-processing succeeded for provider '{}'. Output length: {} chars",
                provider.id,
                content.len()
            );
            Some(content)
        }
        Ok(None) => {
            error!("LLM API response has no content");
            None
        }
        Err(e) => {
            error!(
                "LLM post-processing failed for provider '{}': {}. Falling back to original transcription.",
                provider.id,
                e
            );
            None
        }
    }
}

pub(crate) struct ProcessedTranscription {
    pub final_text: String,
    pub post_processed_text: Option<String>,
    pub post_process_prompt: Option<String>,
    pub should_press_enter: bool,
    /// Characters before the cursor to select first, so the paste replaces
    /// them ("fix by voice" rewriting the dictation just typed). Usually 0.
    pub replace_chars: usize,
}

pub(crate) async fn process_transcription_output(
    app: &AppHandle,
    transcription: &str,
    post_process: bool,
) -> ProcessedTranscription {
    process_transcription_output_for(app, transcription, post_process, None).await
}

/// Like [`process_transcription_output`], for a dictation aimed at
/// `front_app` (whose style, if any, picks the cleanup prompt). Snippets
/// expand last so the LLM never rewrites an expansion.
pub(crate) async fn process_transcription_output_for(
    app: &AppHandle,
    transcription: &str,
    post_process: bool,
    front_app: Option<&crate::utter::FrontApp>,
) -> ProcessedTranscription {
    let settings = get_settings(app);
    let screen_ctx = crate::utter::dictation_screen_context();
    let sel = screen_ctx.as_ref().and_then(|c| c.selected_text.as_deref());

    let mut final_text = if settings.voice_commands {
        crate::utter::apply_voice_commands(transcription)
    } else {
        transcription.to_string()
    };
    if !settings.custom_words.is_empty() {
        final_text = crate::utter::apply_word_replacements(&final_text, &settings.custom_words);
    }
    let mut post_processed_text: Option<String> =
        (final_text != transcription).then(|| final_text.clone());
    let mut post_process_prompt: Option<String> = None;

    // 1. Hey Clicky / Wispr Flow direct screen or web action ("click <button>", "ask Perplexity ...")
    if settings.voice_commands {
        if let Some(action_desc) =
            crate::utter::try_execute_voice_screen_action(app, &final_text, sel)
        {
            return ProcessedTranscription {
                final_text: String::new(),
                post_processed_text: Some(format!("[Action] {action_desc}")),
                post_process_prompt: Some(action_desc),
                should_press_enter: false,
                replace_chars: 0,
            };
        }

        // 2. Wispr Flow inline Command Mode ("Hey Utter, ...", "Hey Flow, ...", or selection edit instruction)
        if crate::utter::llm_available(&settings) {
            if let Some(instruction) = crate::utter::detect_inline_voice_command(&final_text, sel) {
                if let Some(cmd_res) = run_voice_command(app, sel, &instruction).await {
                    return cmd_res;
                }
            }
        }
    }

    // 3. Extract trailing "... press enter" before LLM so LLM sees clean text
    let mut should_press_enter = false;
    if settings.voice_commands {
        let (stripped, press_enter) =
            crate::utter::extract_trailing_press_enter(&final_text, transcription);
        if press_enter {
            final_text = stripped;
            should_press_enter = true;
            post_processed_text = Some(final_text.clone());
        }
    }

    if post_process && !final_text.is_empty() {
        if let Some(processed_text) =
            post_process_transcription(&settings, &final_text, front_app, screen_ctx.as_ref()).await
        {
            let processed_text = if !settings.custom_words.is_empty() {
                crate::utter::apply_word_replacements(&processed_text, &settings.custom_words)
            } else {
                processed_text
            };
            post_processed_text = Some(processed_text.clone());
            final_text = processed_text;
            post_process_prompt =
                resolve_cleanup_prompt(&settings, front_app).map(|(_, prompt)| prompt);
        }
    }

    // Check trailing "... press enter" again in case LLM preserved it
    if settings.voice_commands && !should_press_enter {
        let (stripped, press_enter) =
            crate::utter::extract_trailing_press_enter(&final_text, transcription);
        if press_enter {
            final_text = stripped;
            should_press_enter = true;
            post_processed_text = Some(final_text.clone());
        }
    }

    // 4. Wispr Flow IDE @filename tagging & Slack @person tagging
    if settings.context_awareness && !final_text.is_empty() {
        let tagged =
            crate::utter::apply_ide_and_slack_tagging(&final_text, front_app, screen_ctx.as_ref());
        if tagged != final_text {
            final_text = tagged;
            post_processed_text = Some(final_text.clone());
        }
    }

    // 5. Spoken snippets expansion
    let expanded = crate::utter::apply_snippets(&final_text, &settings.snippets);
    if expanded != final_text {
        final_text = expanded;
        post_processed_text = Some(final_text.clone());
    }

    // 6. Apply Wispr Flow's smart cursor casing, spacing & punctuation matching
    if settings.context_awareness && !final_text.is_empty() {
        let style_id = resolve_cleanup_prompt(&settings, front_app).map(|(id, _)| id);
        let before = screen_ctx.as_ref().and_then(|c| c.before_text.as_deref());
        let after = screen_ctx.as_ref().and_then(|c| c.after_text.as_deref());
        let nouns = screen_ctx
            .as_ref()
            .map(|c| c.proper_nouns.as_slice())
            .unwrap_or(&[]);
        let matched = crate::utter::match_casing_spacing_and_punctuation_full(
            &final_text,
            before,
            sel,
            after,
            nouns,
            &settings.custom_words,
            style_id.as_deref(),
            crate::utter::is_messaging_app(front_app),
        );
        if matched != final_text {
            final_text = matched;
            post_processed_text = Some(final_text.clone());
        }
    }

    if !final_text.is_empty() {
        crate::utter::record_dictation_memory(
            front_app.map(|a| a.name.clone()).unwrap_or_default(),
            screen_ctx.as_ref().and_then(|c| c.window_title.clone()),
            final_text.clone(),
        );
    }

    ProcessedTranscription {
        final_text,
        post_processed_text,
        post_process_prompt,
        should_press_enter,
        replace_chars: 0,
    }
}

/// Runs a command-mode instruction against `selection` (or, with none, asks
/// for new text). `None` when no AI provider could answer.
async fn run_voice_command(
    app: &AppHandle,
    selection: Option<&str>,
    instruction: &str,
) -> Option<ProcessedTranscription> {
    if is_blank_transcription(instruction) {
        return Some(ProcessedTranscription {
            final_text: String::new(),
            post_processed_text: None,
            post_process_prompt: None,
            should_press_enter: false,
            replace_chars: 0,
        });
    }
    if let Some(action_desc) =
        crate::utter::try_execute_voice_screen_action(app, instruction, selection)
    {
        return Some(ProcessedTranscription {
            final_text: String::new(),
            post_processed_text: Some(format!("[Action] {action_desc}")),
            post_process_prompt: Some(action_desc),
            should_press_enter: false,
            replace_chars: 0,
        });
    }
    let settings = get_settings(app);
    debug!(
        "Command mode: instruction '{}', selection {} chars",
        utils::redact_text(instruction),
        selection.map_or(0, str::len)
    );
    // Fix by voice: with nothing selected, the dictation just typed is what
    // the instruction is about. When it still sits right before the cursor
    // (same app, last two minutes), it is replaced in place rather than the
    // rewrite being typed after it.
    let mut replace_chars = 0;
    let fallback_sel: Option<String> = if selection.is_none() {
        let in_place = crate::utter::dictation_screen_context().and_then(|ctx| {
            crate::utter::replaceable_last_dictation(ctx.before_text.as_deref()?, &ctx.app_name)
        });
        match in_place {
            Some((text, chars)) => {
                replace_chars = chars;
                Some(text)
            }
            None => crate::utter::recent_dictation_memory(None, 1)
                .into_iter()
                .next()
                .map(|m| m.text),
        }
    } else {
        None
    };
    let effective_sel = selection.or(fallback_sel.as_deref());
    let (input, prompt) = crate::utter::command_request(effective_sel, instruction);
    let mut output = run_llm_prompt(&settings, &input, &prompt).await;

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    if output.is_none() && apple_intelligence::check_apple_intelligence_availability() {
        let system_prompt = build_system_prompt(&prompt);
        if let Ok(res) =
            apple_intelligence::process_text_with_system_prompt(&system_prompt, &input, 0)
        {
            if !res.trim().is_empty() {
                output = Some(strip_invisible_chars(&res));
            }
        }
    }

    let output = output.unwrap_or_else(|| {
        crate::utter::local_transform_text(effective_sel.unwrap_or(instruction), instruction)
    });
    let output = output.trim().to_string();

    // The rewrite is now the latest dictation, so it can be fixed again.
    if replace_chars > 0 && !output.is_empty() {
        if let Some(ctx) = crate::utter::dictation_screen_context() {
            crate::utter::record_dictation_memory(
                ctx.app_name.clone(),
                ctx.window_title.clone(),
                output.clone(),
            );
        }
    }

    Some(ProcessedTranscription {
        final_text: output.clone(),
        post_processed_text: Some(output),
        post_process_prompt: Some(format!("Command: {}", instruction.trim())),
        should_press_enter: false,
        replace_chars,
    })
}

impl ShortcutAction for TranscribeAction {
    fn start(&self, app: &AppHandle, binding_id: &str, _shortcut_str: &str) {
        let start_time = Instant::now();
        debug!("TranscribeAction::start called for binding: {}", binding_id);
        crate::utter::remember_dictation_app();

        // Load model in the background
        let tm = app.state::<Arc<TranscriptionManager>>();
        let rm = app.state::<Arc<AudioRecordingManager>>();

        // Load ASR model and VAD model in parallel
        let kickoff_started = Instant::now();
        tm.initiate_model_load();
        let rm_clone = Arc::clone(&rm);
        std::thread::spawn(move || {
            if let Err(e) = rm_clone.preload_vad() {
                debug!("VAD pre-load failed: {}", e);
            }
        });
        let kickoff_elapsed = kickoff_started.elapsed();

        // Don't open the mic if nothing can transcribe the recording; the load
        // kicked off above fails and reports why.
        if !tm.is_model_loaded() {
            let selected_model = get_settings(app).selected_model;
            if let Err(e) = app
                .state::<Arc<ModelManager>>()
                .get_model_path(&selected_model)
            {
                warn!("Not starting recording: no model can transcribe it ({})", e);
                return;
            }
        }

        let binding_id = binding_id.to_string();
        RECORDING_SESSION.fetch_add(1, Ordering::SeqCst);
        let tray_started = Instant::now();
        set_tray_state(app, TrayIconState::Recording);
        let tray_elapsed = tray_started.elapsed();

        // Get the microphone mode to determine audio feedback timing
        let plan_started = Instant::now();
        let settings = get_settings(app);
        let is_always_on = settings.always_on_microphone;

        let selected_model_info = app
            .state::<Arc<ModelManager>>()
            .get_model_info(&settings.selected_model);

        // Use the app-facing model capability as the single pre-recording source
        // for live streaming decisions. Unknown support is represented as false
        // until the model registry is updated by discovery or runtime load.
        let model_supports_streaming = selected_model_info
            .as_ref()
            .map(|m| m.supports_streaming)
            .unwrap_or(false);
        let vad_policy = if !settings.vad_enabled {
            VadPolicy::Disabled
        } else if model_supports_streaming {
            VadPolicy::Streaming
        } else {
            VadPolicy::Offline
        };
        // Before the model loads, whether it keeps its accuracy on long audio
        // is unknown, so assume not: the worker decides again with the loaded
        // model, and a wrong guess costs only an idle worker.
        let expected_model = ModelTraits {
            streaming: model_supports_streaming,
            long_form: false,
        };
        if live_decode(expected_model, settings.long_form_chunking) != LiveDecode::None {
            tm.start_stream();
        }
        let plan_elapsed = plan_started.elapsed();

        // Overlay: compact Wispr Flow floating capsule
        let overlay_started = Instant::now();
        match settings.overlay_style {
            OverlayStyle::Live | OverlayStyle::Minimal => show_recording_overlay(app),
            OverlayStyle::None => {} // show_overlay_state no-ops on None anyway
        }
        // Everything above runs before capture can begin, so each span here is
        // added keypress->capture latency.
        debug!(
            "start-path pre-recording steps: model_kickoff={:?} tray={:?} settings+stream_plan={:?} overlay={:?}",
            kickoff_elapsed,
            tray_elapsed,
            plan_elapsed,
            overlay_started.elapsed()
        );
        debug!("Microphone mode - always_on: {}", is_always_on);

        let mut recording_error: Option<anyhow::Error> = None;
        let recording_start_time = Instant::now();
        match rm.try_start_recording(&binding_id, vad_policy) {
            Ok(readiness) => {
                debug!(
                    "Recording request accepted in {:?}; waiting for first microphone samples",
                    recording_start_time.elapsed()
                );
                let generation = readiness.generation();
                let app_clone = app.clone();
                let rm_clone = Arc::clone(&rm);
                std::thread::spawn(move || {
                    if !readiness.wait() {
                        debug!("Microphone readiness wait ended without receiving samples");
                        return;
                    }

                    // Development-only preview hook for evaluating the brief
                    // arming animation on hardware that normally starts too fast
                    // to make it visible.
                    #[cfg(debug_assertions)]
                    if let Ok(delay_ms) = std::env::var("HANDY_DEBUG_MIC_READY_DELAY_MS")
                        .unwrap_or_default()
                        .parse::<u64>()
                    {
                        let delay_ms = delay_ms.min(10_000);
                        if delay_ms > 0 {
                            debug!("Delaying microphone-ready cue by {delay_ms}ms for UI preview");
                            std::thread::sleep(Duration::from_millis(delay_ms));
                        }
                    }

                    if !rm_clone.is_recording_readiness_current(generation) {
                        debug!("Microphone became ready for an inactive recording");
                        return;
                    }

                    debug!("Microphone is receiving samples; recording is ready");
                    utils::emit_recording_ready(&app_clone);

                    // The start chime is a readiness cue, so it must follow the
                    // first real input callback rather than Stream::play() or a
                    // fixed delay. The helper returns immediately when feedback
                    // is disabled; mute still follows the same readiness point.
                    if rm_clone.is_recording_readiness_current(generation) {
                        play_feedback_sound_blocking(&app_clone, SoundType::Start);
                    }
                    if rm_clone.is_recording_readiness_current(generation) {
                        rm_clone.apply_mute();
                    }
                });
            }
            Err(e) => {
                debug!("Failed to start recording: {}", e);
                recording_error = Some(e);
            }
        }

        if recording_error.is_none() {
            // Notes and meetings can run for an hour; a global Escape pressed in
            // another app must not silently discard them. They end only through
            // their own stop control (the voice-note shortcut or Notes' Stop).
            if self.mode != DictationMode::Note {
                // Dynamically register the cancel shortcut in a separate task to avoid deadlock
                shortcut::register_cancel_shortcut(app);
            } else {
                let hm = app.state::<Arc<HistoryManager>>();
                crate::recovery::start_session(hm.recordings_dir().to_path_buf(), "note");
            }
        } else {
            // Starting failed (for example due to blocked microphone permissions).
            // Revert UI state so we don't stay stuck in the recording overlay.
            tm.cancel_stream();
            utils::hide_recording_overlay(app);
            set_tray_state(app, TrayIconState::Idle);
            if let Some(err) = recording_error {
                let _ = app.emit(
                    "recording-error",
                    RecordingErrorEvent {
                        error_type: recording_error_type(&err).to_string(),
                        detail: Some(format!("{err:#}")),
                    },
                );
            }
        }

        debug!(
            "TranscribeAction::start completed in {:?}",
            start_time.elapsed()
        );
    }

    fn stop(&self, app: &AppHandle, binding_id: &str, _shortcut_str: &str) {
        // Prevent a slow microphone from emitting a ready event or start chime
        // after the user has already requested stop.
        app.state::<Arc<AudioRecordingManager>>()
            .invalidate_recording_readiness();

        // Unregister the cancel shortcut when transcription stops
        shortcut::unregister_cancel_shortcut(app);

        let stop_time = Instant::now();
        debug!("TranscribeAction::stop called for binding: {}", binding_id);

        let ah = app.clone();
        let rm = Arc::clone(&app.state::<Arc<AudioRecordingManager>>());
        let tm = Arc::clone(&app.state::<Arc<TranscriptionManager>>());
        let hm = Arc::clone(&app.state::<Arc<HistoryManager>>());

        set_tray_state(app, TrayIconState::Transcribing);
        // Stop should give immediate visual feedback. Live streaming can keep
        // the larger panel, but it still switches from listening to a working
        // spinner while the stream finalizes. Non-streaming paths use the
        // compact transcribing pill (None no-ops in show_*).
        let _style = get_settings(app).overlay_style;
        let use_streaming_overlay = false;
        show_transcribing_overlay(app);

        // Unmute before playing audio feedback so the stop sound is audible
        rm.remove_mute();

        // Play audio feedback for recording stop
        play_feedback_sound(app, SoundType::Stop);

        let binding_id = binding_id.to_string(); // Clone binding_id for the async task
        let mode = self.mode;
        let post_process = self.post_process
            || (mode == DictationMode::Dictate && {
                let settings = get_settings(app);
                settings.auto_cleanup && settings.post_process_enabled
            });
        let front_app = crate::utter::dictation_app();
        let cancel_generation = rm.cancel_generation();

        tauri::async_runtime::spawn(async move {
            let _guard = FinishGuard(ah.clone(), Arc::clone(&tm));
            debug!(
                "Starting async transcription task for binding: {}",
                binding_id
            );

            // Command mode copies the selection while the keys are released
            // (a copy shortcut sent with the hotkey's modifiers still held
            // would be a different chord).
            let selection = if mode == DictationMode::Command {
                let ah_for_copy = ah.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    std::thread::sleep(Duration::from_millis(150));
                    crate::utter::capture_selection(&ah_for_copy)
                })
                .await
                .ok()
                .flatten()
            } else {
                None
            };

            let stop_recording_time = Instant::now();
            if let Some(mut samples) = rm.stop_recording(&binding_id, cancel_generation) {
                // Read now: by the time transcribing ends, another take may
                // have replaced it.
                let input_silent = rm.last_input_silent();
                debug!(
                    "Recording stopped and samples retrieved in {:?}, sample count: {}",
                    stop_recording_time.elapsed(),
                    samples.len()
                );

                if rm.was_cancelled_since(cancel_generation) {
                    debug!("Transcription operation cancelled after recording stop");
                    crate::recovery::discard_session();
                    tm.cancel_stream();
                    utils::hide_recording_overlay(&ah);
                    set_tray_state(&ah, TrayIconState::Idle);
                    return;
                }

                if samples.is_empty() {
                    debug!("Recording produced no audio samples; skipping persistence");
                    crate::recovery::finish_session();
                    // Tear down any streaming worker so its channel doesn't leak
                    // and block the next start_stream.
                    tm.cancel_stream();
                    utils::hide_recording_overlay(&ah);
                    set_tray_state(&ah, TrayIconState::Idle);
                    emit_transcription_complete(&ah, empty_outcome(input_silent), 0, stop_time);
                } else {
                    if get_settings(&ah).whisper_mode {
                        crate::utter::boost_quiet_audio(&mut samples);
                    }
                    // Save WAV concurrently with transcription
                    let sample_count = samples.len();
                    let file_prefix = if mode == DictationMode::Note {
                        "note"
                    } else {
                        "utter"
                    };
                    let file_name = format!("{file_prefix}-{}.wav", chrono::Utc::now().timestamp());
                    let wav_path = hm.recordings_dir().join(&file_name);
                    let wav_path_for_verify = wav_path.clone();
                    let samples_for_wav = samples.clone();
                    let wav_handle = tauri::async_runtime::spawn_blocking(move || {
                        crate::audio_toolkit::save_wav_file(&wav_path, &samples_for_wav)
                    });

                    // Transcribe concurrently with WAV save: the live decode's
                    // result when it has one (all audio was already fed to it),
                    // otherwise a batch run of the samples. A cancel is surfaced
                    // as an error, so it never starts a batch run.
                    let transcription_time = Instant::now();
                    let transcription_result = tm.transcribe_recording(samples);

                    // Await WAV save and verify
                    let wav_saved = match wav_handle.await {
                        Ok(Ok(())) => {
                            match crate::audio_toolkit::verify_wav_file(
                                &wav_path_for_verify,
                                sample_count,
                            ) {
                                Ok(()) => true,
                                Err(e) => {
                                    error!("WAV verification failed: {}", e);
                                    false
                                }
                            }
                        }
                        Ok(Err(e)) => {
                            error!("Failed to save WAV file: {}", e);
                            false
                        }
                        Err(e) => {
                            error!("WAV save task panicked: {}", e);
                            false
                        }
                    };

                    if rm.was_cancelled_since(cancel_generation) {
                        debug!("Transcription operation cancelled before output handling");
                        utils::hide_recording_overlay(&ah);
                        set_tray_state(&ah, TrayIconState::Idle);
                        return;
                    }

                    match transcription_result {
                        Ok(Transcription {
                            text: transcription,
                            language,
                        }) => {
                            debug!(
                                "Transcription completed in {:?}: '{}'",
                                transcription_time.elapsed(),
                                utils::redact_text(&transcription)
                            );

                            let audio_seconds = sample_count as f64
                                / crate::audio_toolkit::constants::WHISPER_SAMPLE_RATE as f64;

                            if mode == DictationMode::Note {
                                // Notes keep their recording outside history,
                                // so history retention never deletes it.
                                let outcome = if is_blank_transcription(&transcription) {
                                    empty_outcome(input_silent)
                                } else {
                                    save_voice_note(
                                        &ah,
                                        transcription.trim(),
                                        wav_saved.then(|| file_name.clone()),
                                        audio_seconds,
                                        None,
                                        None,
                                    );
                                    let _ = hm.record_usage(
                                        &transcription,
                                        audio_seconds,
                                        mode.usage_label(),
                                        None,
                                    );
                                    TranscriptionOutcome::Typed
                                };
                                crate::recovery::finish_session();
                                utils::hide_recording_overlay(&ah);
                                set_tray_state(&ah, TrayIconState::Idle);
                                emit_transcription_complete(&ah, outcome, sample_count, stop_time);
                                return;
                            }

                            if post_process || mode == DictationMode::Command {
                                if use_streaming_overlay {
                                    tm.emit_stream_working(StreamWorkKind::Polishing);
                                } else {
                                    show_processing_overlay(&ah);
                                }
                            }
                            let output = async {
                                if mode == DictationMode::Command {
                                    run_voice_command(&ah, selection.as_deref(), &transcription)
                                        .await
                                } else {
                                    Some(
                                        process_transcription_output_for(
                                            &ah,
                                            &transcription,
                                            post_process,
                                            front_app.as_ref(),
                                        )
                                        .await,
                                    )
                                }
                            };
                            let Some(processed) = complete_unless_cancelled(output, || {
                                rm.was_cancelled_since(cancel_generation)
                            })
                            .await
                            else {
                                debug!("Transcription operation cancelled during output handling");
                                utils::hide_recording_overlay(&ah);
                                set_tray_state(&ah, TrayIconState::Idle);
                                return;
                            };
                            let Some(processed) = processed else {
                                // Command mode without a working AI provider:
                                // typing the raw instruction would be wrong.
                                let _ = ah.emit(
                                    "transcription-error",
                                    "Command mode needs AI post-processing: turn it on and choose a provider.",
                                );
                                utils::hide_recording_overlay(&ah);
                                set_tray_state(&ah, TrayIconState::Idle);
                                emit_transcription_complete(
                                    &ah,
                                    TranscriptionOutcome::Failed,
                                    sample_count,
                                    stop_time,
                                );
                                return;
                            };
                            let _ = hm.record_usage(
                                &processed.final_text,
                                audio_seconds,
                                mode.usage_label(),
                                front_app.as_ref().map(|a| a.name.as_str()),
                            );

                            if rm.was_cancelled_since(cancel_generation) {
                                debug!("Transcription operation cancelled before paste");
                                utils::hide_recording_overlay(&ah);
                                set_tray_state(&ah, TrayIconState::Idle);
                                return;
                            }

                            // Save to history if WAV was saved
                            if wav_saved {
                                if let Err(err) = hm.save_entry(
                                    file_name.clone(),
                                    transcription.clone(),
                                    post_process || mode == DictationMode::Command,
                                    processed.post_processed_text.clone(),
                                    processed.post_process_prompt.clone(),
                                    language,
                                ) {
                                    error!("Failed to save history entry: {}", err);
                                }
                            }

                            // Automatic meeting recording and notetaking:
                            // Check whether the recording is a meeting, voice note, standup,
                            // or action item list, via speech content, active meeting app, or duration.
                            let screen_ctx = crate::utter::dictation_screen_context();
                            let classification = crate::utter::classify_recording(
                                transcription.trim(),
                                audio_seconds,
                                screen_ctx.as_ref(),
                            );

                            if classification.should_save_note
                                && !is_blank_transcription(&transcription)
                            {
                                info!(
                                    "Auto-detected note/meeting: kind={}, template={}, tags={:?}, title='{}'",
                                    classification.kind,
                                    classification.template,
                                    classification.tags,
                                    classification.title
                                );
                                save_voice_note(
                                    &ah,
                                    transcription.trim(),
                                    wav_saved.then(|| file_name.clone()),
                                    audio_seconds,
                                    Some(classification.template),
                                    Some(classification.tags),
                                );
                            }

                            // Privacy: with "keep audio" off, the recording is
                            // deleted once its text is saved. A note keeps its
                            // audio (speaker labels and summaries read it).
                            if wav_saved
                                && !classification.should_save_note
                                && !get_settings(&ah).keep_audio
                            {
                                let path = hm.get_audio_file_path(&file_name);
                                if let Err(e) = std::fs::remove_file(&path) {
                                    warn!("Could not delete the recording: {e}");
                                }
                            }

                            if processed.final_text.is_empty() {
                                utils::hide_recording_overlay(&ah);
                                set_tray_state(&ah, TrayIconState::Idle);
                                emit_transcription_complete(
                                    &ah,
                                    empty_outcome(input_silent),
                                    sample_count,
                                    stop_time,
                                );
                            } else {
                                let ah_clone = ah.clone();
                                let paste_time = Instant::now();
                                let final_text = processed.final_text;
                                let should_press_enter = processed.should_press_enter;
                                let replace_chars = processed.replace_chars;
                                let rm_for_paste = Arc::clone(&rm);
                                // Taken before the paste thread exists, and so
                                // before the next session can start.
                                let session = RECORDING_SESSION.load(Ordering::SeqCst);
                                // Off the main thread: paste sleeps between steps, and a
                                // paste into Handy's own windows needs the main thread free.
                                std::thread::Builder::new()
                                    .name("paste".into())
                                    .spawn(move || {
                                        if rm_for_paste.was_cancelled_since(cancel_generation) {
                                            debug!(
                                                "Transcription operation cancelled before paste"
                                            );
                                            utils::hide_recording_overlay(&ah_clone);
                                            set_tray_state(&ah_clone, TrayIconState::Idle);
                                            return;
                                        }

                                        // Fix by voice: select the dictation being
                                        // rewritten so the paste replaces it.
                                        if replace_chars > 0 {
                                            if let Err(e) = crate::clipboard::with_enigo(
                                                &ah_clone,
                                                move |enigo| {
                                                    crate::input::send_select_left(
                                                        enigo,
                                                        replace_chars,
                                                    )
                                                },
                                            ) {
                                                warn!("Could not select the last dictation: {e}");
                                            }
                                            std::thread::sleep(Duration::from_millis(30));
                                        }
                                        let outcome =
                                            match utils::paste(final_text, ah_clone.clone()) {
                                                Ok(()) => {
                                                    debug!(
                                                        "Text pasted successfully in {:?}",
                                                        paste_time.elapsed()
                                                    );
                                                    if should_press_enter {
                                                        std::thread::sleep(Duration::from_millis(
                                                            50,
                                                        ));
                                                        let _ = crate::clipboard::with_enigo(
                                                            &ah_clone,
                                                            |enigo| {
                                                                use enigo::{
                                                                    Direction, Key, Keyboard,
                                                                };
                                                                enigo
                                                                    .key(
                                                                        Key::Return,
                                                                        Direction::Click,
                                                                    )
                                                                    .map_err(|e| e.to_string())
                                                            },
                                                        );
                                                    }
                                                    TranscriptionOutcome::Typed
                                                }
                                                Err(e) => {
                                                    error!("Failed to paste transcription: {}", e);
                                                    let _ = ah_clone.emit("paste-error", ());
                                                    TranscriptionOutcome::Failed
                                                }
                                            };
                                        // A new session may have started while
                                        // this paste ran; the UI is now its.
                                        if RECORDING_SESSION.load(Ordering::SeqCst) == session {
                                            utils::hide_recording_overlay(&ah_clone);
                                            set_tray_state(&ah_clone, TrayIconState::Idle);
                                        }
                                        emit_transcription_complete(
                                            &ah_clone,
                                            outcome,
                                            sample_count,
                                            stop_time,
                                        );
                                    })
                                    .map(|_| ())
                                    .unwrap_or_else(|e| {
                                        error!("Failed to start the paste thread: {:?}", e);
                                        utils::hide_recording_overlay(&ah);
                                        set_tray_state(&ah, TrayIconState::Idle);
                                        emit_transcription_complete(
                                            &ah,
                                            TranscriptionOutcome::Failed,
                                            sample_count,
                                            stop_time,
                                        );
                                    });
                            }
                        }
                        Err(err) => {
                            if mode == DictationMode::Note {
                                crate::recovery::finish_session();
                            }
                            if rm.was_cancelled_since(cancel_generation) {
                                debug!(
                                    "Transcription operation cancelled after transcription error"
                                );
                                utils::hide_recording_overlay(&ah);
                                set_tray_state(&ah, TrayIconState::Idle);
                                return;
                            }

                            error!("Transcription failed: {}", err);
                            // Surface the failure to the UI (toast). The full
                            // message is also in handy.log via the line above.
                            let _ = ah.emit("transcription-error", err.to_string());
                            // Save entry with empty text so user can retry
                            if wav_saved {
                                if let Err(save_err) = hm.save_entry(
                                    file_name,
                                    String::new(),
                                    post_process,
                                    None,
                                    None,
                                    None,
                                ) {
                                    error!("Failed to save failed history entry: {}", save_err);
                                }
                            }
                            utils::hide_recording_overlay(&ah);
                            set_tray_state(&ah, TrayIconState::Idle);
                            emit_transcription_complete(
                                &ah,
                                TranscriptionOutcome::Failed,
                                sample_count,
                                stop_time,
                            );
                        }
                    }
                }
            } else {
                debug!("No samples retrieved from recording stop");
                // Tear down any streaming worker so its channel doesn't leak.
                tm.cancel_stream();
                utils::hide_recording_overlay(&ah);
                set_tray_state(&ah, TrayIconState::Idle);
                if !rm.was_cancelled_since(cancel_generation) {
                    emit_transcription_complete(&ah, TranscriptionOutcome::Empty, 0, stop_time);
                }
            }
        });

        debug!(
            "TranscribeAction::stop completed in {:?}",
            stop_time.elapsed()
        );
    }
}

// Cancel Action
struct CancelAction;

impl ShortcutAction for CancelAction {
    fn start(&self, app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {
        utils::cancel_current_operation(app);
    }

    fn stop(&self, _app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {
        // Nothing to do on stop for cancel
    }
}

/// Re-types (or copies) the most recent dictation, like Wispr Flow's
/// "paste last transcript". Runs on release, once the shortcut's own keys are
/// up, so the paste chord isn't mixed with them.
struct LastTranscriptAction {
    paste: bool,
}

impl ShortcutAction for LastTranscriptAction {
    fn start(&self, _app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {}

    fn stop(&self, app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {
        let app = app.clone();
        let paste = self.paste;
        std::thread::spawn(move || {
            if paste {
                crate::input::wait_for_modifiers_released(Duration::from_millis(1500));
                crate::tray::paste_last_transcript(&app);
            } else {
                crate::tray::copy_last_transcript(&app);
            }
        });
    }
}

// Test Action
struct TestAction;

impl ShortcutAction for TestAction {
    fn start(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str) {
        log::info!(
            "Shortcut ID '{}': Started - {} (App: {})", // Changed "Pressed" to "Started" for consistency
            binding_id,
            shortcut_str,
            app.package_info().name
        );
    }

    fn stop(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str) {
        log::info!(
            "Shortcut ID '{}': Stopped - {} (App: {})", // Changed "Released" to "Stopped" for consistency
            binding_id,
            shortcut_str,
            app.package_info().name
        );
    }
}

// Static Action Map
pub static ACTION_MAP: Lazy<HashMap<String, Arc<dyn ShortcutAction>>> = Lazy::new(|| {
    let mut map = HashMap::new();
    map.insert(
        "transcribe".to_string(),
        Arc::new(TranscribeAction {
            post_process: false,
            mode: DictationMode::Dictate,
        }) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "transcribe_with_post_process".to_string(),
        Arc::new(TranscribeAction {
            post_process: true,
            mode: DictationMode::Dictate,
        }) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "command_mode".to_string(),
        Arc::new(TranscribeAction {
            post_process: false,
            mode: DictationMode::Command,
        }) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "voice_note".to_string(),
        Arc::new(TranscribeAction {
            post_process: false,
            mode: DictationMode::Note,
        }) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "cancel".to_string(),
        Arc::new(CancelAction) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "paste_last_transcript".to_string(),
        Arc::new(LastTranscriptAction { paste: true }) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "copy_last_transcript".to_string(),
        Arc::new(LastTranscriptAction { paste: false }) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "test".to_string(),
        Arc::new(TestAction) as Arc<dyn ShortcutAction>,
    );
    map
});

#[cfg(test)]
mod tests {
    use super::{
        complete_unless_cancelled, is_blank_transcription, should_use_streaming_overlay,
        strip_think_block,
    };
    use crate::settings::OverlayStyle;
    use std::future;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::thread;
    use std::time::Duration;

    #[test]
    fn blank_transcription_is_detected() {
        assert!(is_blank_transcription(""));
        assert!(is_blank_transcription("   "));
        assert!(is_blank_transcription("\t\n  \r\n"));
    }

    #[test]
    fn non_blank_transcription_is_kept() {
        assert!(!is_blank_transcription("hello"));
        assert!(!is_blank_transcription("  hello  "));
    }

    #[test]
    fn completed_operation_returns_its_output() {
        let result = tauri::async_runtime::block_on(complete_unless_cancelled(
            future::ready("done"),
            || false,
        ));

        assert_eq!(result, Some("done"));
    }

    #[test]
    fn pending_operation_stops_after_cancellation() {
        let cancelled = Arc::new(AtomicBool::new(false));
        let cancelled_for_thread = Arc::clone(&cancelled);
        let cancel_thread = thread::spawn(move || {
            thread::sleep(Duration::from_millis(10));
            cancelled_for_thread.store(true, Ordering::Release);
        });

        let result = tauri::async_runtime::block_on(complete_unless_cancelled(
            future::pending::<()>(),
            || cancelled.load(Ordering::Acquire),
        ));

        cancel_thread.join().unwrap();
        assert_eq!(result, None);
    }

    #[test]
    fn leading_think_block_is_stripped() {
        assert_eq!(
            strip_think_block("<think>pondering...</think>Cleaned text."),
            "Cleaned text."
        );
        assert_eq!(
            strip_think_block("  \n<think>multi\nline</think>\n  Cleaned text."),
            "Cleaned text."
        );
    }

    #[test]
    fn content_without_think_block_is_unchanged() {
        assert_eq!(strip_think_block("Cleaned text."), "Cleaned text.");
        assert_eq!(
            strip_think_block("Mentions <think> mid-sentence."),
            "Mentions <think> mid-sentence."
        );
        // Unclosed block: leave untouched rather than guess
        assert_eq!(
            strip_think_block("<think>never closed"),
            "<think>never closed"
        );
    }

    #[test]
    fn live_overlay_uses_streaming_states_only_for_streaming_models() {
        assert!(should_use_streaming_overlay(OverlayStyle::Live, true));
        assert!(!should_use_streaming_overlay(OverlayStyle::Live, false));
        assert!(!should_use_streaming_overlay(OverlayStyle::Minimal, true));
        assert!(!should_use_streaming_overlay(OverlayStyle::None, true));
    }
}
