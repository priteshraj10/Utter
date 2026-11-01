# Utter

**Local-first AI voice dictation, command mode, context-aware tone adaptation, and voice notes for your desktop.**

Utter is an open-source desktop dictation studio built with Tauri, Rust, and React/TypeScript. Hold a shortcut, speak naturally, and have clean, formatted text pasted into whatever app you are using—powered by local speech recognition and on-device or cloud AI refinement.

## Highlights & Features

- **Utter Flow Studio**: Interactive home dashboard with live speaking stats, active shortcut badges, quick toggles for **AI Cleanup** and **Whisper Mode**, and a built-in AI Scratchpad to test rewrites, snippets, and custom voice commands.
- **Offline Speech Recognition**: Local transcription powered by **Whisper** (Small / Medium / Turbo / Large with Metal & Vulkan GPU acceleration) and **Parakeet** (fast CPU-optimized model with automatic language detection), with **Silero VAD** silence filtering.
- **Context-Aware AI Cleanup**: Removes filler words, fixes punctuation and capitalization, resolves mid-sentence self-corrections, and adapts formatting to your active application. On Apple Silicon Macs, **Apple Intelligence** is enabled out of the box (on-device, private, no API key needed). Also supports OpenAI, Anthropic, Groq, OpenRouter, Ollama, and custom OpenAI-compatible endpoints.
- **Whisper Mode (Quiet Voice Boost)**: Speak softly in libraries, shared offices, or late at night—Utter applies soft-knee dynamic gain amplification to quiet speech before transcription without clipping.
- **Per-App Tone & Smart Defaults**: Automatically picks the right writing style (**Formal**, **Casual**, **Very Casual**, **Concise**, **Email**, **Bullet Notes**, **Code & Technical**, or custom prompts) based on the frontmost app (`Slack`, `Mail`, `Notion`, `VS Code`, `Cursor`, `Terminal`, etc.), with 1-click smart app presets.
- **Dynamic Spoken Snippets**: Expand short voice cues (e.g., _"daily standup"_, _"my calendar link"_, _"standard sign off"_) into full blocks of text with dynamic variable expansion (`{{date}}`, `{{time}}`, `{{day}}`, `{{datetime}}`).
- **Command Mode (`Ctrl+Shift+Space`)**: Select text in any application, hold the Command Mode shortcut, and speak an editing instruction (_"make this more concise"_, _"turn into bullet points"_, _"translate to Spanish"_) or ask for new text to replace the selection in place.
- **Voice Notes & AI Transform Bar (`Alt+Shift+N`)**: Capture quick thoughts or meeting notes from anywhere. Notes are searchable, editable with autosave, and include 1-click AI transformations (**Summarize + Action Items**, **Clean Up**, **Concise**, **Bullet List**, **Email Draft**) plus automatic summaries for recordings over 60 seconds.
- **Smart Auto-Learn Dictionary & Domain Packs**: Edit any transcript in **History** to automatically extract and learn corrected names, acronyms, and jargon into your Custom Dictionary, or add curated 1-click vocabulary packs (_Engineering & AI_, _Product & Design_, _Business & Finance_).
- **Full-Text History Search & Usage Stats**: Instantly search across raw transcripts and AI-cleaned output, toggle between raw and polished views, and track total words dictated, speaking WPM, estimated time saved, daily streaks, and top apps.

## Quick Start

### Prerequisites

- [Rust](https://rustup.rs/) (latest stable)
- [Bun](https://bun.sh/) package manager

### Development & Build

```bash
# Install frontend dependencies
bun install

# Run in development mode
CMAKE_POLICY_VERSION_MINIMUM=3.5 bun run tauri dev

# Build application bundle
CMAKE_POLICY_VERSION_MINIMUM=3.5 bun run tauri build
```

For detailed platform-specific prerequisites, see [BUILD.md](BUILD.md).

## Default Shortcuts

| Action           | Default Shortcut           | Description                                              |
| ---------------- | -------------------------- | -------------------------------------------------------- |
| **Dictate**      | `Ctrl+Space`               | Record speech and paste into the active text field       |
| **Command Mode** | `Ctrl+Shift+Space`         | Edit selected text or generate text by voice instruction |
| **Voice Note**   | `Alt+Shift+N`              | Record a voice note directly into Utter's Notes library  |
| **Cancel**       | `Escape` (while recording) | Cancel the active recording or transcription             |

All shortcuts can be customized in **Settings** and **Personalize**, with support for Push-to-Talk, Toggle, or Hybrid modes.

## CLI Parameters

Utter supports command-line flags for controlling a running instance from scripts, Raycast, or window managers:

```bash
# Remote control flags (sent to the running instance)
utter --toggle-transcription    # Toggle dictation on/off
utter --toggle-post-process     # Toggle dictation with AI post-processing on/off
utter --toggle-command-mode     # Toggle command mode on/off
utter --toggle-voice-note       # Toggle voice note recording on/off
utter --cancel                  # Cancel the current operation

# Startup flags
utter --start-hidden            # Start minimized to the system tray
utter --no-tray                 # Start without the system tray icon
utter --debug                   # Enable debug mode with verbose logging
```

## App Data Directory

Utter stores settings, downloaded models, `history.db` (transcriptions, usage stats, and FTS index), and `notes.db` in the platform app data directory under `app.utter.desktop`:

- **macOS**: `~/Library/Application Support/app.utter.desktop/`
- **Windows**: `C:\Users\{username}\AppData\Roaming\app.utter.desktop\`
- **Linux**: `~/.config/app.utter.desktop/`

## License

Released under the [MIT License](LICENSE).
