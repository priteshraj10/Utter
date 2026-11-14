//! Notes: voice notes and longer meeting-style recordings, stored with an
//! optional AI summary. Kept in their own database so history retention never
//! touches them.

use anyhow::{anyhow, Result};
use chrono::Utc;
use log::{error, info};
use rusqlite::{params, Connection, OptionalExtension};
use rusqlite_migration::{Migrations, M};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};

static MIGRATIONS: &[M] = &[
    M::up(
        "CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        summary TEXT,
        audio_file TEXT,
        audio_seconds REAL NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );",
    ),
    // Notetaker: pinning, tags, the kind of note and the summary template.
    M::up(
        "ALTER TABLE notes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
         ALTER TABLE notes ADD COLUMN tags TEXT NOT NULL DEFAULT '';
         ALTER TABLE notes ADD COLUMN kind TEXT NOT NULL DEFAULT 'text';
         ALTER TABLE notes ADD COLUMN summary_template TEXT;
         UPDATE notes SET kind = 'voice' WHERE audio_seconds > 0 AND audio_seconds < 60;
         UPDATE notes SET kind = 'meeting' WHERE audio_seconds >= 60;",
    ),
];

const NOTE_COLUMNS: &str = "id, title, body, summary, audio_file, audio_seconds, created_at, \
     updated_at, pinned, tags, kind, summary_template";

/// What a note came from; drives its icon, filters and default summary.
pub mod kind {
    /// Typed or pasted by the user.
    pub const TEXT: &str = "text";
    /// A short dictated voice note.
    pub const VOICE: &str = "voice";
    /// A long recording, summarized as meeting notes.
    pub const MEETING: &str = "meeting";
    /// An AI digest of a day's dictations and notes.
    pub const DIGEST: &str = "digest";
}

/// Event the Notes page listens to; the payload is the changed note's id.
pub const NOTES_CHANGED_EVENT: &str = "notes-changed";

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct Note {
    pub id: i64,
    pub title: String,
    pub body: String,
    pub summary: Option<String>,
    /// Recording in the history recordings folder, for voice notes.
    pub audio_file: Option<String>,
    pub audio_seconds: f64,
    pub created_at: i64,
    pub updated_at: i64,
    pub pinned: bool,
    pub tags: Vec<String>,
    /// One of [`kind`]'s values.
    pub kind: String,
    /// The template the current summary was written with.
    pub summary_template: Option<String>,
}

/// Tags are stored comma-separated; this keeps them trimmed and unique.
pub fn normalize_tags(tags: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for tag in tags {
        let tag = tag.trim().trim_start_matches('#').replace(',', " ");
        let tag = tag.trim();
        if !tag.is_empty() && !out.iter().any(|t| t.eq_ignore_ascii_case(tag)) {
            out.push(tag.to_string());
        }
    }
    out
}

/// One question and its answer in a saved notes chat.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct ChatTurn {
    pub question: String,
    pub answer: crate::actions::NotesAnswer,
}

/// A saved "Ask your notes" conversation.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct NoteChat {
    pub id: i64,
    /// The first question, shortened.
    pub title: String,
    pub turns: Vec<ChatTurn>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// A chat in the Recent chats list (no turns).
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct NoteChatSummary {
    pub id: i64,
    pub title: String,
    pub turn_count: u32,
    pub updated_at: i64,
}

/// A chat's title: its first question, cut at a word to about 60 characters.
pub fn chat_title(turns: &[ChatTurn]) -> String {
    let first = turns.first().map(|t| t.question.trim()).unwrap_or_default();
    let mut title = String::new();
    for word in first.split_whitespace() {
        if !title.is_empty() && title.chars().count() + word.chars().count() + 1 > 60 {
            title.push('…');
            return title;
        }
        if !title.is_empty() {
            title.push(' ');
        }
        title.push_str(word);
    }
    title
}

pub struct NotesManager {
    app_handle: AppHandle,
    db_path: PathBuf,
}

impl NotesManager {
    pub fn new(app_handle: &AppHandle) -> Result<Self> {
        let db_path = crate::portable::app_data_dir(app_handle)?.join("notes.db");
        let mut conn = Connection::open(&db_path)?;
        Migrations::new(MIGRATIONS.to_vec()).to_latest(&mut conn)?;
        // Saved "Ask your notes" chats. A new table, not a migration: a
        // higher schema version would make older builds refuse notes.db.
        conn.execute(
            "CREATE TABLE IF NOT EXISTS note_chats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                turns TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )",
            [],
        )?;
        info!("Notes database ready at {:?}", db_path);
        Ok(Self {
            app_handle: app_handle.clone(),
            db_path,
        })
    }

    fn conn(&self) -> Result<Connection> {
        Ok(Connection::open(&self.db_path)?)
    }

    fn map_note(row: &rusqlite::Row<'_>) -> rusqlite::Result<Note> {
        Ok(Note {
            id: row.get("id")?,
            title: row.get("title")?,
            body: row.get("body")?,
            summary: row.get("summary")?,
            audio_file: row.get("audio_file")?,
            audio_seconds: row.get("audio_seconds")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
            pinned: row.get("pinned")?,
            tags: row
                .get::<_, String>("tags")?
                .split(',')
                .map(str::trim)
                .filter(|t| !t.is_empty())
                .map(String::from)
                .collect(),
            kind: row.get("kind")?,
            summary_template: row.get("summary_template")?,
        })
    }

    fn changed(&self, id: i64) {
        if let Err(e) = self.app_handle.emit(NOTES_CHANGED_EVENT, id) {
            error!("Failed to emit {NOTES_CHANGED_EVENT}: {e}");
        }
    }

    /// Notes newest first; `query` filters on title, body and summary.
    pub fn list(&self, query: Option<&str>) -> Result<Vec<Note>> {
        let conn = self.conn()?;
        let query = query.map(str::trim).filter(|q| !q.is_empty());
        let notes = match query {
            Some(q) => {
                let like = format!("%{}%", q.replace('%', "\\%").replace('_', "\\_"));
                let mut stmt = conn.prepare(&format!(
                    "SELECT {NOTE_COLUMNS} FROM notes
                     WHERE title LIKE ?1 ESCAPE '\\' OR body LIKE ?1 ESCAPE '\\'
                        OR summary LIKE ?1 ESCAPE '\\' OR tags LIKE ?1 ESCAPE '\\'
                     ORDER BY pinned DESC, updated_at DESC"
                ))?;
                let rows = stmt.query_map([like], Self::map_note)?;
                rows.collect::<rusqlite::Result<Vec<_>>>()?
            }
            None => {
                let mut stmt = conn.prepare(&format!(
                    "SELECT {NOTE_COLUMNS} FROM notes ORDER BY pinned DESC, updated_at DESC"
                ))?;
                let rows = stmt.query_map([], Self::map_note)?;
                rows.collect::<rusqlite::Result<Vec<_>>>()?
            }
        };
        Ok(notes)
    }

    pub fn get(&self, id: i64) -> Result<Option<Note>> {
        let conn = self.conn()?;
        Ok(conn
            .query_row(
                &format!("SELECT {NOTE_COLUMNS} FROM notes WHERE id = ?1"),
                [id],
                Self::map_note,
            )
            .optional()?)
    }

    pub fn create(
        &self,
        title: &str,
        body: &str,
        audio_file: Option<String>,
        audio_seconds: f64,
        note_kind: &str,
    ) -> Result<Note> {
        let now = Utc::now().timestamp();
        let conn = self.conn()?;
        conn.execute(
            "INSERT INTO notes (title, body, audio_file, audio_seconds, created_at, updated_at, kind)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6)",
            params![title, body, audio_file, audio_seconds, now, note_kind],
        )?;
        let id = conn.last_insert_rowid();
        self.changed(id);
        self.get(id)?
            .ok_or_else(|| anyhow!("note {id} vanished after insert"))
    }

    pub fn update(&self, id: i64, title: &str, body: &str) -> Result<()> {
        let conn = self.conn()?;
        conn.execute(
            "UPDATE notes SET title = ?1, body = ?2, updated_at = ?3 WHERE id = ?4",
            params![title, body, Utc::now().timestamp(), id],
        )?;
        self.changed(id);
        Ok(())
    }

    pub fn set_summary(
        &self,
        id: i64,
        summary: Option<&str>,
        template: Option<&str>,
    ) -> Result<()> {
        let conn = self.conn()?;
        conn.execute(
            "UPDATE notes SET summary = ?1, summary_template = COALESCE(?2, summary_template),
                 updated_at = ?3
             WHERE id = ?4",
            params![summary, template, Utc::now().timestamp(), id],
        )?;
        self.changed(id);
        Ok(())
    }

    pub fn set_title(&self, id: i64, title: &str) -> Result<()> {
        let conn = self.conn()?;
        conn.execute(
            "UPDATE notes SET title = ?1 WHERE id = ?2",
            params![title, id],
        )?;
        self.changed(id);
        Ok(())
    }

    /// Pinning does not bump `updated_at`, so the list order stays stable.
    pub fn set_pinned(&self, id: i64, pinned: bool) -> Result<()> {
        let conn = self.conn()?;
        conn.execute(
            "UPDATE notes SET pinned = ?1 WHERE id = ?2",
            params![pinned, id],
        )?;
        self.changed(id);
        Ok(())
    }

    pub fn set_tags(&self, id: i64, tags: &[String]) -> Result<Vec<String>> {
        let tags = normalize_tags(tags);
        let conn = self.conn()?;
        conn.execute(
            "UPDATE notes SET tags = ?1 WHERE id = ?2",
            params![tags.join(","), id],
        )?;
        self.changed(id);
        Ok(tags)
    }

    /// Notes created or edited at or after `since` (Unix seconds).
    pub fn changed_since(&self, since: i64) -> Result<Vec<Note>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {NOTE_COLUMNS} FROM notes WHERE updated_at >= ?1 ORDER BY created_at ASC"
        ))?;
        let rows = stmt.query_map([since], Self::map_note)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Saved chats, most recently used first.
    pub fn list_chats(&self, limit: usize) -> Result<Vec<NoteChatSummary>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, title, turns, updated_at FROM note_chats
             ORDER BY updated_at DESC, id DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit as i64], |r| {
            let turns: String = r.get(2)?;
            let turn_count = serde_json::from_str::<Vec<serde_json::Value>>(&turns)
                .map(|t| t.len() as u32)
                .unwrap_or(0);
            Ok(NoteChatSummary {
                id: r.get(0)?,
                title: r.get(1)?,
                turn_count,
                updated_at: r.get(3)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn get_chat(&self, id: i64) -> Result<Option<NoteChat>> {
        let conn = self.conn()?;
        let row = conn
            .query_row(
                "SELECT id, title, turns, created_at, updated_at FROM note_chats WHERE id = ?1",
                params![id],
                |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, i64>(3)?,
                        r.get::<_, i64>(4)?,
                    ))
                },
            )
            .optional()?;
        let Some((id, title, turns, created_at, updated_at)) = row else {
            return Ok(None);
        };
        Ok(Some(NoteChat {
            id,
            title,
            turns: serde_json::from_str(&turns)?,
            created_at,
            updated_at,
        }))
    }

    /// Saves a chat's turns: updates chat `id`, or creates a new chat when
    /// `id` is `None` (or no longer exists). Returns the chat's id.
    pub fn save_chat(&self, id: Option<i64>, turns: &[ChatTurn]) -> Result<i64> {
        if turns.is_empty() {
            return Err(anyhow!("A chat needs at least one question"));
        }
        let conn = self.conn()?;
        let now = Utc::now().timestamp();
        let title = chat_title(turns);
        let json = serde_json::to_string(turns)?;
        if let Some(id) = id {
            let updated = conn.execute(
                "UPDATE note_chats SET title = ?1, turns = ?2, updated_at = ?3 WHERE id = ?4",
                params![title, json, now, id],
            )?;
            if updated > 0 {
                return Ok(id);
            }
        }
        conn.execute(
            "INSERT INTO note_chats (title, turns, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?3)",
            params![title, json, now],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn delete_chat(&self, id: i64) -> Result<()> {
        self.conn()?
            .execute("DELETE FROM note_chats WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn delete(&self, id: i64) -> Result<()> {
        let conn = self.conn()?;
        conn.execute("DELETE FROM notes WHERE id = ?1", [id])?;
        self.changed(id);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn chat_title_is_the_first_question_cut_at_a_word() {
        use super::{chat_title, ChatTurn};
        use crate::actions::NotesAnswer;
        let turn = |q: &str| ChatTurn {
            question: q.to_string(),
            answer: NotesAnswer {
                answer: String::new(),
                sources: vec![],
            },
        };
        assert_eq!(
            chat_title(&[turn("  What did we decide?  ")]),
            "What did we decide?"
        );
        let long = "What were all the action items we agreed on in the Monday planning meeting with design";
        let title = chat_title(&[turn(long), turn("and then?")]);
        assert!(title.ends_with('…'));
        assert!(title.chars().count() <= 61);
        assert!(long.starts_with(title.trim_end_matches('…')));
        assert_eq!(chat_title(&[]), "");
    }

    use super::*;

    #[test]
    fn tags_are_trimmed_and_deduplicated() {
        let tags = normalize_tags(&[" #work ".into(), "Work".into(), "".into(), "a,b".into()]);
        assert_eq!(tags, vec!["work".to_string(), "a b".to_string()]);
    }
}
