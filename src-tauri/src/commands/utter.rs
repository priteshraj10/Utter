//! Commands for Utter's features: notes, history search, usage stats,
//! snippets, per-app styles and always-on AI cleanup.

use crate::managers::history::{HistoryEntry, HistoryManager, UsageStats};
use crate::managers::notes::{Note, NotesManager};
use crate::settings::{self, AppStyle, Snippet};
use std::sync::Arc;
use tauri::{AppHandle, State};

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
        .create(&title, &body, None, 0.0)
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
pub async fn summarize_note(app: AppHandle, id: i64) -> Result<String, String> {
    crate::actions::summarize_note(&app, id).await
}

/// Starts or stops a voice note, as its shortcut would in toggle mode.
#[tauri::command]
#[specta::specta]
pub fn toggle_voice_note(app: AppHandle) {
    crate::signal_handle::send_transcription_input(&app, "voice_note", "UI");
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
    if !crate::utter::llm_available(&s) {
        return Err(
            "Turn on AI post-processing and select a provider to run AI transformations.".into(),
        );
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
    let result = crate::actions::run_llm_prompt(&s, &input, &prompt)
        .await
        .ok_or_else(|| "The AI provider returned no output.".to_string())?;
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
