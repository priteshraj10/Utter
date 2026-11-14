//! Commands for Utter's features: notes, history search, usage stats,
//! snippets, per-app styles and always-on AI cleanup.

use crate::managers::history::{HistoryEntry, HistoryManager, UsageStats};
use crate::managers::notes::{Note, NotesManager};
use crate::settings::{self, AppStyle, Snippet};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
#[specta::specta]
pub async fn search_history_entries(
    history_manager: State<'_, Arc<HistoryManager>>,
    query: String,
) -> Result<Vec<HistoryEntry>, String> {
    history_manager
        .search_history_entries(&query, 200)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn get_usage_stats(
    history_manager: State<'_, Arc<HistoryManager>>,
) -> Result<UsageStats, String> {
    history_manager.usage_stats().map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn list_notes(
    notes: State<'_, Arc<NotesManager>>,
    query: Option<String>,
) -> Result<Vec<Note>, String> {
    notes.list(query.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn create_note(
    notes: State<'_, Arc<NotesManager>>,
    title: String,
    body: String,
) -> Result<Note, String> {
    notes
        .create(&title, &body, None, 0.0, crate::managers::notes::kind::TEXT)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn create_note_with_audio(
    notes: State<'_, Arc<NotesManager>>,
    title: String,
    body: String,
    audio_file: Option<String>,
    audio_seconds: Option<f64>,
    kind: Option<String>,
) -> Result<Note, String> {
    let k = kind
        .as_deref()
        .unwrap_or(crate::managers::notes::kind::VOICE);
    let s = audio_seconds.unwrap_or(0.0);
    notes
        .create(&title, &body, audio_file, s, k)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn update_note(
    notes: State<'_, Arc<NotesManager>>,
    id: i64,
    title: String,
    body: String,
) -> Result<(), String> {
    notes.update(id, &title, &body).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn delete_note(
    notes: State<'_, Arc<NotesManager>>,
    history_manager: State<'_, Arc<HistoryManager>>,
    id: i64,
) -> Result<(), String> {
    if let Ok(Some(note)) = notes.get(id) {
        if let Some(file) = note.audio_file {
            let path = history_manager.get_audio_file_path(&file);
            if let Err(e) = std::fs::remove_file(&path) {
                log::warn!("Could not delete note audio {:?}: {}", path, e);
            }
        }
    }
    notes.delete(id).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn summarize_note(
    app: AppHandle,
    id: i64,
    template: Option<String>,
) -> Result<String, String> {
    crate::actions::summarize_note(&app, id, template).await
}

/// Whether a local AI (Ollama) is installed and running, and its model.
#[tauri::command]
#[specta::specta]
pub async fn local_ai_status() -> crate::local_llm::LocalAiStatus {
    crate::local_llm::status().await
}

/// Whether the speaker model is on disk, and how big its download is.
#[derive(serde::Serialize, specta::Type)]
pub struct SpeakerModelStatus {
    pub downloaded: bool,
    pub size_mb: u32,
}

#[tauri::command]
#[specta::specta]
pub fn speaker_model_status(app: AppHandle) -> SpeakerModelStatus {
    SpeakerModelStatus {
        downloaded: crate::speakers::model_ready(&app),
        size_mb: crate::catalog::DIARIZER
            .as_ref()
            .map(|d| (d.size_bytes / 1_000_000) as u32)
            .unwrap_or(0),
    }
}

/// Finds who spoke when in note `id`, rewrites its transcript with speaker
/// labels and re-summarizes it. Returns how many speakers were found.
#[tauri::command]
#[specta::specta]
pub async fn label_note_speakers(app: AppHandle, id: i64) -> Result<u32, String> {
    crate::speakers::label_note_speakers(&app, id)
        .await
        .map(|n| n as u32)
        .map_err(|e| e.to_string())
}

/// Transcribes note `id` again from its recording and re-summarizes it.
#[tauri::command]
#[specta::specta]
pub async fn retranscribe_note(app: AppHandle, id: i64) -> Result<(), String> {
    crate::speakers::retranscribe_note(&app, id)
        .await
        .map_err(|e| e.to_string())
}

/// Replaces (or clears) a note's summary, e.g. after ticking an action item.
#[tauri::command]
#[specta::specta]
pub fn update_note_summary(
    notes: State<'_, Arc<NotesManager>>,
    id: i64,
    summary: Option<String>,
) -> Result<(), String> {
    notes
        .set_summary(id, summary.as_deref(), None)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn set_note_pinned(
    notes: State<'_, Arc<NotesManager>>,
    id: i64,
    pinned: bool,
) -> Result<(), String> {
    notes.set_pinned(id, pinned).map_err(|e| e.to_string())
}

/// Stores a note's tags and returns them normalized.
#[tauri::command]
#[specta::specta]
pub fn set_note_tags(
    notes: State<'_, Arc<NotesManager>>,
    id: i64,
    tags: Vec<String>,
) -> Result<Vec<String>, String> {
    notes.set_tags(id, &tags).map_err(|e| e.to_string())
}

/// Answers a question from the user's notes, citing the notes used.
#[tauri::command]
#[specta::specta]
pub async fn ask_notes(
    app: AppHandle,
    question: String,
    history: Option<Vec<crate::utter::ChatExchange>>,
) -> Result<crate::actions::NotesAnswer, String> {
    crate::actions::ask_notes(&app, &question, history.as_deref().unwrap_or(&[])).await
}

/// Returns recent dictations from conversational context memory.
#[tauri::command]
#[specta::specta]
pub fn get_dictation_context_memory() -> Vec<crate::utter::DictationMemoryItem> {
    crate::utter::recent_dictation_memory(None, 10)
}

/// Clears the rolling dictation context memory.
#[tauri::command]
#[specta::specta]
pub fn clear_dictation_context_memory() {
    crate::utter::clear_dictation_memory();
}

/// Builds an AI digest of today's dictations and notes as a new note.
#[tauri::command]
#[specta::specta]
pub async fn create_daily_digest(app: AppHandle) -> Result<Note, String> {
    crate::actions::create_daily_digest(&app).await
}

#[tauri::command]
#[specta::specta]
pub fn change_voice_commands_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut s = settings::get_settings(&app);
    s.voice_commands = enabled;
    settings::write_settings(&app, s);
    Ok(())
}

/// Starts or stops a voice note, as its shortcut would in toggle mode.
#[tauri::command]
#[specta::specta]
pub fn toggle_voice_note(app: AppHandle) {
    crate::signal_handle::send_transcription_input(&app, "voice_note", "UI");
}

/// Starts or stops a dictation from the floating bar, like the shortcut.
#[tauri::command]
#[specta::specta]
pub fn toggle_dictation(app: AppHandle) {
    crate::signal_handle::send_transcription_input(&app, "transcribe", "Floating bar");
}

/// Finishes the recording `binding_id` started and types the result (the
/// floating bar's Stop button). Does nothing when nothing is recording, so a
/// late click can never start a new recording.
#[tauri::command]
#[specta::specta]
pub fn stop_dictation(app: AppHandle, binding_id: String) {
    use crate::managers::audio::AudioRecordingManager;
    use tauri::Manager;
    if !crate::transcription_coordinator::is_transcribe_binding(&binding_id) {
        return;
    }
    let recording = app
        .try_state::<Arc<AudioRecordingManager>>()
        .is_some_and(|audio| audio.is_recording());
    if recording {
        crate::signal_handle::send_transcription_input(&app, &binding_id, "Floating bar");
    }
}

/// Shows the resting floating bar (if it is on and not hidden).
#[tauri::command]
#[specta::specta]
pub fn show_floating_bar(app: AppHandle) {
    crate::overlay::show_floating_bar(&app);
}

/// Hides the floating bar for `minutes`, then brings it back.
#[tauri::command]
#[specta::specta]
pub fn hide_floating_bar(app: AppHandle, minutes: u32) {
    crate::overlay::hide_floating_bar_for(&app, u64::from(minutes.clamp(1, 24 * 60)));
    let _ = app.emit("floating-bar-hidden", minutes);
}

/// Brings a hidden floating bar back now.
#[tauri::command]
#[specta::specta]
pub fn unhide_floating_bar(app: AppHandle) {
    crate::overlay::unhide_floating_bar(&app);
}

/// Whether to use the built-in mic when the default input is Bluetooth.
#[tauri::command]
#[specta::specta]
pub fn change_prefer_builtin_mic_setting(
    app: AppHandle,
    audio: State<'_, Arc<crate::managers::audio::AudioRecordingManager>>,
    enabled: bool,
) {
    let mut s = settings::get_settings(&app);
    s.prefer_builtin_mic = enabled;
    settings::write_settings(&app, s);
    // The cached device may be the one this setting picked.
    audio.invalidate_device_cache();
}

/// Turns recording meeting call audio (Teams, Zoom, Meet) on or off.
#[tauri::command]
#[specta::specta]
pub fn change_record_system_audio_setting(app: AppHandle, enabled: bool) {
    let mut s = settings::get_settings(&app);
    s.record_system_audio = enabled;
    settings::write_settings(&app, s);
}

/// Turns the floating bar on or off.
#[tauri::command]
#[specta::specta]
pub fn change_floating_bar_setting(app: AppHandle, enabled: bool) {
    let mut s = settings::get_settings(&app);
    s.floating_bar = enabled;
    settings::write_settings(&app, s);
    if enabled {
        crate::overlay::unhide_floating_bar(&app);
    } else if !crate::tray::dictation_in_progress(&app) {
        crate::overlay::hide_overlay_window(&app);
    }
}

#[tauri::command]
#[specta::specta]
pub fn set_snippets(app: AppHandle, snippets: Vec<Snippet>) -> Result<(), String> {
    let mut s = settings::get_settings(&app);
    s.snippets = snippets;
    settings::write_settings(&app, s);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn set_app_styles(app: AppHandle, app_styles: Vec<AppStyle>) -> Result<(), String> {
    let mut s = settings::get_settings(&app);
    s.app_styles = app_styles;
    settings::write_settings(&app, s);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_auto_cleanup_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut s = settings::get_settings(&app);
    s.auto_cleanup = enabled;
    settings::write_settings(&app, s);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_whisper_mode_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut s = settings::get_settings(&app);
    s.whisper_mode = enabled;
    settings::write_settings(&app, s);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_keep_audio_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut s = settings::get_settings(&app);
    s.keep_audio = enabled;
    settings::write_settings(&app, s);
    Ok(())
}

/// Where your words go: on this Mac only, or also to a cloud AI provider.
#[derive(serde::Serialize, specta::Type)]
pub struct PrivacyStatus {
    /// True when nothing you say or type is sent off this computer.
    pub on_device: bool,
    /// The cloud AI provider's name when text is sent to one.
    pub cloud_provider: Option<String>,
    /// Whether audio recordings are kept after typing.
    pub keeps_audio: bool,
}

#[tauri::command]
#[specta::specta]
pub fn get_privacy_status(app: AppHandle) -> PrivacyStatus {
    let s = settings::get_settings(&app);
    let cloud_provider = s.cloud_ai_provider().map(|p| p.label.clone());
    PrivacyStatus {
        on_device: cloud_provider.is_none(),
        cloud_provider,
        keeps_audio: s.keep_audio,
    }
}

/// Transforms `text` using spoken snippets and either a built-in style prompt ID
/// or a free-form command instruction.
#[tauri::command]
#[specta::specta]
pub async fn transform_text(
    app: AppHandle,
    text: String,
    instruction: String,
) -> Result<String, String> {
    let s = settings::get_settings(&app);
    let expanded = crate::utter::apply_snippets(&text, &s.snippets);
    if instruction.trim().is_empty() || instruction == "snippets_only" {
        return Ok(expanded);
    }
    let (input, prompt) = if let Some(preset) = s
        .post_process_prompts
        .iter()
        .find(|p| p.id == instruction.trim())
    {
        (expanded.clone(), preset.prompt.clone())
    } else {
        crate::utter::command_request(Some(&expanded), &instruction)
    };
    let mut result = crate::actions::run_llm_prompt(&s, &input, &prompt).await;

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    if result.is_none() && crate::apple_intelligence::check_apple_intelligence_availability() {
        let system_prompt = prompt.replace("${output}", "").trim().to_string();
        if let Ok(res) =
            crate::apple_intelligence::process_text_with_system_prompt(&system_prompt, &input, 0)
        {
            if !res.trim().is_empty() {
                result = Some(res);
            }
        }
    }

    let result = result.unwrap_or_else(|| crate::utter::local_transform_text(&input, &instruction));
    Ok(crate::utter::apply_snippets(result.trim(), &s.snippets))
}

/// Extracts newly corrected or capitalized words from an edited transcript and
/// adds them to the user's custom dictionary.
#[tauri::command]
#[specta::specta]
pub fn learn_words_from_edit(
    app: AppHandle,
    original: String,
    edited: String,
) -> Result<Vec<String>, String> {
    let mut s = settings::get_settings(&app);
    let learned = crate::utter::extract_learned_words(&original, &edited, &s.custom_words);
    if !learned.is_empty() {
        s.custom_words.extend(learned.iter().cloned());
        settings::write_settings(&app, s);
    }
    Ok(learned)
}

/// The app in front right now, for filling in a per-app style.
#[tauri::command]
#[specta::specta]
pub fn get_frontmost_app() -> Option<String> {
    crate::utter::frontmost_app().map(|app| app.name)
}

/// Returns the most recently captured or live ScreenContext (active app, window
/// title, cursor text, screen proper nouns, IDE files, and clickable buttons).
#[tauri::command]
#[specta::specta]
pub fn get_screen_context() -> crate::utter::ScreenContext {
    let live = crate::utter::capture_screen_context();
    if !live.app_name.is_empty() && !live.app_name.eq_ignore_ascii_case("Utter") {
        return live;
    }
    crate::utter::dictation_screen_context().unwrap_or(live)
}

#[tauri::command]
#[specta::specta]
pub fn change_context_awareness_setting(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut s = settings::get_settings(&app);
    s.context_awareness = enabled;
    settings::write_settings(&app, s);
    Ok(())
}
