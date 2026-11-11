//! A local AI the user already has: Ollama on this Mac. When no provider is
//! set up, notes features (summaries, titles, Ask, digests, rewrites, Command
//! mode) use it instead of falling back to rule-based text, so they work
//! offline and privately with no configuration.
//!
//! Per-dictation cleanup doesn't use it: a local model's latency on every
//! dictation would make typing feel slow.

use log::{debug, info, warn};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const BASE_URL: &str = "http://127.0.0.1:11434";
/// How long a detection result is trusted before asking Ollama again.
const DETECT_TTL: Duration = Duration::from_secs(60);
/// Long meetings make long prompts; local models are slower than the cloud.
const CHAT_TIMEOUT: Duration = Duration::from_secs(300);
/// Ollama's default context (2–4k tokens) truncates an hour-long transcript.
const CONTEXT_TOKENS: u32 = 16_384;

/// Chat models that summarize well and run comfortably on a laptop, best
/// first. Matched against the start of the model name.
const PREFERRED: &[&str] = &[
    "qwen3", "llama3.2", "gemma3", "gemma4", "llama3.1", "mistral", "phi4", "phi3", "gpt-oss",
];
/// Bigger than this is too slow for a laptop unless it's all there is.
const COMFORTABLE_BYTES: u64 = 10_000_000_000;

#[derive(Debug, Clone, Serialize, Type)]
pub struct LocalAiStatus {
    /// Ollama looks installed on this computer.
    pub installed: bool,
    /// Ollama answered and has a model Utter can use.
    pub running: bool,
    /// The model Utter picked.
    pub model: Option<String>,
}

#[derive(Deserialize)]
struct Tags {
    models: Vec<TagModel>,
}

#[derive(Deserialize)]
struct TagModel {
    name: String,
    #[serde(default)]
    size: u64,
}

/// When Ollama was last asked, and the model it offered then.
type Detection = Option<(Instant, Option<String>)>;

static DETECTED: Lazy<Mutex<Detection>> = Lazy::new(|| Mutex::new(None));

fn client(timeout: Duration) -> Option<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(timeout)
        .connect_timeout(Duration::from_millis(800))
        .build()
        .ok()
}

/// Picks the model to use from Ollama's list: never a cloud model (that
/// would send notes off the computer) or an embedding model.
pub fn pick_model(models: &[(String, u64)]) -> Option<String> {
    let usable: Vec<&(String, u64)> = models
        .iter()
        .filter(|(name, _)| {
            let n = name.to_lowercase();
            !n.contains("cloud") && !n.contains("embed") && !n.contains("vision")
        })
        .collect();
    let rank = |name: &str| {
        let n = name.to_lowercase();
        PREFERRED
            .iter()
            .position(|p| n.starts_with(p))
            .unwrap_or(PREFERRED.len())
    };
    let best = |list: Vec<&&(String, u64)>| {
        list.into_iter()
            .min_by_key(|(name, size)| (rank(name), *size))
            .map(|(name, _)| name.clone())
    };
    let comfortable: Vec<_> = usable
        .iter()
        .filter(|(_, size)| *size > 0 && *size <= COMFORTABLE_BYTES)
        .collect();
    best(comfortable).or_else(|| best(usable.iter().collect()))
}

/// The Ollama model to use, if Ollama is running and has one. Cached briefly.
pub async fn detect() -> Option<String> {
    if let Some((at, model)) = DETECTED.lock().unwrap().as_ref() {
        if at.elapsed() < DETECT_TTL {
            return model.clone();
        }
    }
    let model = fetch_model().await;
    *DETECTED.lock().unwrap() = Some((Instant::now(), model.clone()));
    model
}

async fn fetch_model() -> Option<String> {
    let response = client(Duration::from_secs(2))?
        .get(format!("{BASE_URL}/api/tags"))
        .send()
        .await
        .ok()?;
    let tags: Tags = response.json().await.ok()?;
    let models: Vec<(String, u64)> = tags.models.into_iter().map(|m| (m.name, m.size)).collect();
    let picked = pick_model(&models);
    if let Some(model) = &picked {
        debug!("Local AI: Ollama model '{model}'");
    }
    picked
}

/// Whether Ollama is installed, without asking it anything.
fn installed() -> bool {
    let home = std::env::var_os("HOME").map(std::path::PathBuf::from);
    [
        Some(std::path::PathBuf::from("/Applications/Ollama.app")),
        Some(std::path::PathBuf::from("/opt/homebrew/bin/ollama")),
        Some(std::path::PathBuf::from("/usr/local/bin/ollama")),
        home.map(|h| h.join(".ollama")),
    ]
    .into_iter()
    .flatten()
    .any(|p| p.exists())
}

pub async fn status() -> LocalAiStatus {
    let model = detect().await;
    LocalAiStatus {
        installed: installed() || model.is_some(),
        running: model.is_some(),
        model,
    }
}

#[derive(Serialize)]
struct ChatRequest<'a> {
    model: &'a str,
    messages: [Message<'a>; 2],
    stream: bool,
    /// Skip a reasoning model's thinking: these are short, simple tasks.
    think: bool,
    options: ChatOptions,
}

#[derive(Serialize)]
struct Message<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Serialize)]
struct ChatOptions {
    temperature: f32,
    num_ctx: u32,
}

#[derive(Deserialize)]
struct ChatResponse {
    message: ResponseMessage,
}

#[derive(Deserialize)]
struct ResponseMessage {
    content: String,
}

/// Runs `system` over `input` with the local model. `None` when Ollama isn't
/// available or fails; the caller falls back.
pub async fn chat(system: &str, input: &str) -> Option<String> {
    let model = detect().await?;
    let started = Instant::now();
    let request = ChatRequest {
        model: &model,
        messages: [
            Message {
                role: "system",
                content: system,
            },
            Message {
                role: "user",
                content: input,
            },
        ],
        stream: false,
        think: false,
        options: ChatOptions {
            temperature: 0.2,
            num_ctx: CONTEXT_TOKENS,
        },
    };
    let send = |request: &ChatRequest| {
        client(CHAT_TIMEOUT).map(|c| c.post(format!("{BASE_URL}/api/chat")).json(request).send())
    };
    let mut response = send(&request)?.await.ok()?;
    if response.status() == reqwest::StatusCode::BAD_REQUEST {
        // Older Ollama, or a model without thinking, rejects `think`.
        let mut plain = serde_json::to_value(&request).ok()?;
        plain.as_object_mut()?.remove("think");
        response = client(CHAT_TIMEOUT)?
            .post(format!("{BASE_URL}/api/chat"))
            .json(&plain)
            .send()
            .await
            .ok()?;
    }
    if !response.status().is_success() {
        warn!("Local AI ({model}) failed: HTTP {}", response.status());
        return None;
    }
    let text = response.json::<ChatResponse>().await.ok()?.message.content;
    let text = strip_thinking(&text);
    if text.is_empty() {
        return None;
    }
    info!(
        "Local AI ({model}) answered in {:.1}s",
        started.elapsed().as_secs_f32()
    );
    Some(text)
}

/// Removes a `<think>…</think>` block some models emit anyway.
fn strip_thinking(text: &str) -> String {
    let trimmed = text.trim();
    match (trimmed.find("<think>"), trimmed.find("</think>")) {
        (Some(start), Some(end)) if end > start => format!(
            "{}{}",
            &trimmed[..start],
            &trimmed[end + "</think>".len()..]
        )
        .trim()
        .to_string(),
        _ => trimmed.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn models(list: &[(&str, u64)]) -> Vec<(String, u64)> {
        list.iter().map(|(n, s)| (n.to_string(), *s)).collect()
    }

    #[test]
    fn picks_a_small_local_chat_model() {
        // This machine's actual list.
        let list = models(&[
            ("gpt-oss:20b", 13_800_000_000),
            ("gpt-oss:120b-cloud", 0),
            ("llama3.2:3b", 2_000_000_000),
            ("nomic-embed-text:latest", 300_000_000),
            ("qwen3.5:cloud", 0),
            ("mydeck-llama:latest", 8_500_000_000),
        ]);
        assert_eq!(pick_model(&list).as_deref(), Some("llama3.2:3b"));
    }

    #[test]
    fn never_picks_cloud_or_embedding_models() {
        let list = models(&[("qwen3.5:cloud", 0), ("embeddinggemma:latest", 600_000_000)]);
        assert_eq!(pick_model(&list), None);
    }

    #[test]
    fn falls_back_to_a_big_model_when_it_is_all_there_is() {
        let list = models(&[("gpt-oss:20b", 13_800_000_000)]);
        assert_eq!(pick_model(&list).as_deref(), Some("gpt-oss:20b"));
    }

    #[test]
    fn removes_thinking() {
        assert_eq!(
            strip_thinking("<think>hmm</think>\n## Summary"),
            "## Summary"
        );
        assert_eq!(strip_thinking("  plain  "), "plain");
    }
}
