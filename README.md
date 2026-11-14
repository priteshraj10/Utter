# Utter

**Local-first AI voice dictation, command mode, meeting call recording, and smart notes for your desktop.**

Utter is an open-source, private desktop dictation studio built with Tauri 2.x, Rust, and React/TypeScript. Hold a shortcut, speak naturally, and have clean, formatted text typed into any application—powered by on-device speech recognition and private AI refinement.

---

## Highlights & Features

- **Wispr Flow–Style Floating Bar**: Minimal, distraction-free floating pill at rest that expands on hover or hotkey. Features live audio waveforms, instant cancel, and median typing speed metrics.
- **System Call & Meeting Recording (Teams, Zoom, Meet)**: Capture both your microphone and computer audio in Notes so multi-participant meetings and browser calls include every speaker. Includes speaker diarization and automated summary action items.
- **Offline Speech Recognition**: Local transcription powered by **Whisper** (Small / Medium / Turbo / Large with Apple Silicon Metal & Vulkan GPU acceleration) and **Parakeet**, paired with **Silero VAD** for voice activity detection.
- **Mixed Hindi + English (Hinglish) Support**: Transcribes natural multilingual code-switching seamlessly without transliteration errors or unwanted translation into pure English.
- **Context-Aware AI Cleanup & Tone Adaptation**: Strips filler words (*um, uh, like*), repairs self-corrections, and matches writing style (**Formal**, **Casual**, **Very Casual**, **Concise**, **Email**, **Bullet Notes**, **Code & Technical**) according to the active frontmost app (*Slack, Mail, Notion, VS Code, Cursor, Terminal*).
- **Apple Intelligence & Local Intelligence**: On Apple Silicon Macs, uses on-device Apple Intelligence natively without API keys or cloud dependencies. Also supports Ollama, Groq, Anthropic, OpenAI, OpenRouter, and custom endpoints.
- **Fix by Voice & In-Place Rewrites**: Speak editing instructions to rewrite the last dictation directly before your cursor, or use Command Mode on selected text.
- **Whisper Mode (Quiet Speech Boost)**: Speak softly in public or late at night with dynamic soft-knee gain amplification without audio clipping.
- **Privacy You Can See**: Audio and transcripts stay strictly on your device. Includes a "Keep audio recordings" toggle to delete raw audio the moment it is transcribed.

---

## Default Shortcuts

| Action | macOS | Windows / Linux | Description |
| :--- | :--- | :--- | :--- |
| **Dictate** | `fn` *(or `⌥Space`)* | `Ctrl+Space` | Hold to speak, release to type into active app |
| **Command Mode** | `⌃⌥Space` | `Ctrl+Alt+Space` | Edit selected text or rewrite last dictation by voice |
| **Voice Notes & Meetings** | `⌃⌥N` | `Ctrl+Alt+N` | Record meeting or voice note directly into Notes |
| **AI Cleanup Toggle** | `⌥⇧Space` | `Ctrl+Shift+Space` | Dictate with AI post-processing prompt |
| **Paste Last Dictation** | `⌃⌘V` | `Ctrl+Win+V` | Re-paste the most recent dictation |
| **Copy Last Dictation** | `⌃⌘C` | `Ctrl+Win+C` | Copy the most recent dictation to clipboard |
| **Cancel** | `Escape` | `Escape` | Discard current recording or transcribing |

*All shortcuts are customizable in **Settings** (Push-to-Talk, Tap-to-Toggle, or Hybrid).*

---

## Installation

### Download from GitHub Releases
Pre-built binaries for macOS (Apple Silicon / Intel), Windows, and Linux are published on [GitHub Releases](https://github.com/priteshraj10/Utter/releases).

- **macOS**: Download the `.dmg`, drag Utter to `/Applications`. If macOS displays an *"unidentified developer"* prompt on first launch:
  1. Open **System Settings → Privacy & Security**.
  2. Scroll to the Security section and click **Open Anyway**.
  3. Grant **Accessibility** and **Microphone** permissions when prompted.
- **Windows**: Run the `.exe` installer. If Windows Defender SmartScreen appears, click **More info → Run anyway**.
- **Linux**: Install via `.deb`, `.rpm`, or `.AppImage`.

---

## Development & Build

### Prerequisites
- [Rust](https://rustup.rs/) (latest stable)
- [Bun](https://bun.sh/) package manager

```bash
# Install dependencies
bun install

# Run in development mode
CMAKE_POLICY_VERSION_MINIMUM=3.5 bun run tauri dev

# Build release bundle
CMAKE_POLICY_VERSION_MINIMUM=3.5 bun run tauri build
```

---

## Application Data Directory

Utter stores settings, downloaded speech models, recordings, and SQLite databases (`history.db`, `notes.db`) locally:

- **macOS**: `~/Library/Application Support/com.priteshraj.utter/`
- **Windows**: `C:\Users\{username}\AppData\Roaming\com.priteshraj.utter\`
- **Linux**: `~/.config/com.priteshraj.utter/`

---

## Acknowledgments & Credits

Utter is built on top of [Handy](https://github.com/cjpais/Handy) by [CJ Pais](https://github.com/cjpais), licensed under the MIT License. We are grateful for their pioneering work in open-source desktop speech recognition.

## License

Released under the [MIT License](LICENSE).
