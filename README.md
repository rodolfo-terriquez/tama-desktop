# Tama Desktop

Japanese conversation practice app built with Tauri + React.  
Current app includes scenario chat, persistent persona chats, voice mode with local VAD/Whisper, session feedback, and SRS flashcards.

## Current State (March 2026)

Implemented:

- Scenario-based conversations (voice or text input)
- Persistent persona chats with conversation summarization
- Session feedback (grammar, vocabulary, fluency, rating)
- SRS flashcards with SM-2 scheduling and Anki export
- Session history + monthly stats
- Two TTS engines:
  - VOICEVOX (managed from app; supports in-app download on supported platforms)
  - Style-Bert-VITS2 (optional local Python server)
- Two transcription engines:
  - Local Whisper (`ggml-small.bin`, downloaded in app)
  - OpenAI Whisper API
- Auto-update checks on app launch (production builds)

## Tech Stack

| Layer | Choice |
| --- | --- |
| Desktop shell | Tauri v2 (Rust) |
| Frontend | React 19 + TypeScript + Vite 7 |
| UI | Tailwind CSS 4 + shadcn/ui |
| LLM providers | Anthropic API or OpenRouter |
| Speech recognition | Local Whisper (Rust `whisper-rs`) or OpenAI Whisper API |
| TTS | VOICEVOX or Style-Bert-VITS2 |
| Local storage | SQLite (`@tauri-apps/plugin-sql`) + localStorage |

## Prerequisites

- Node.js 20+
- npm
- Rust toolchain (for Tauri desktop app builds)
- API keys:
  - Anthropic (`sk-ant-...`) or OpenRouter (`sk-or-...`) for LLM
  - OpenAI (`sk-...`) for Whisper API key entry on onboarding

Optional (for local components):

- `7z` for in-app VOICEVOX engine download/extraction  
  macOS: `brew install p7zip`
- Python 3 + Style-Bert-VITS2 dependencies (only if using SBV2 TTS)
- SBV2 model files in `sbv2-models/` (only if using SBV2 TTS)

Linux dev/build also needs WebKit and audio system libraries (see `.github/workflows/release.yml` for the exact package list used in CI).

## Quick Start (Desktop)

```bash
npm install
npm run tauri dev
```

On first launch:

1. Enter LLM provider key (Anthropic or OpenRouter)
2. Enter OpenAI key in onboarding dialog
3. Open Settings and choose:
   - TTS engine (VOICEVOX or SBV2)
   - Speech recognition engine (Local Whisper or OpenAI API)
4. If using Local Whisper, download/load the model from Settings

## Optional Setup

### VOICEVOX

- Can be started/downloaded from Settings -> TTS Engine -> VOICEVOX.
- Default endpoint: `http://localhost:50021`.

### Style-Bert-VITS2 (SBV2)

Create virtualenv and install dependencies:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install style-bert-vits2 fastapi uvicorn
```

Put model folders in `sbv2-models/`, then start from Settings (the app launches `server/sbv2_api.py`) or run manually:

```bash
python server/sbv2_api.py --port 5001 --models sbv2-models
```

## Available Scripts

```bash
npm run dev         # Frontend only (Vite dev server)
npm run tauri dev   # Full desktop app in development
npm run build       # Frontend build
npm run tauri build # Desktop production build
npm run lint
npm run preview
```

## Data and Persistence

- Main app data: SQLite database `tama.db` (Tauri app data directory)
- API keys and some preferences: `localStorage` (inside Tauri WebView)
- Local Whisper model: app data `models/ggml-small.bin`
- Downloaded VOICEVOX engine: app data `engines/voicevox/`
- Legacy localStorage data is migrated to SQLite on first DB load

## Project Structure

```text
src/                 # React app (screens, hooks, services)
src-tauri/           # Rust backend (Whisper, VAD, TTS process management, updater, DB migrations)
server/sbv2_api.py   # Optional local SBV2 API bridge
```

## Known Caveats

- Onboarding currently requires entering an OpenAI key even if you plan to use local Whisper afterward.
- API keys are stored in localStorage, not OS keychain.
- SBV2 models are not bundled; you must provide them in `sbv2-models/`.

## Release Notes

For release and updater signing steps, see [`RELEASE_CHECKLIST.md`](./RELEASE_CHECKLIST.md).

## License

MIT
