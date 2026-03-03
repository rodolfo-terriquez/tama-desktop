# Tama - Japanese Conversation Practice

A local web app for Japanese conversation practice with adaptive AI scenarios, built-in SRS vocabulary, and VOICEVOX TTS.

## Quick Start

### Prerequisites

1. **Node.js** (v18+)
2. **VOICEVOX Engine** - Download from [VOICEVOX releases](https://github.com/VOICEVOX/voicevox_engine/releases)
   - For macOS (Apple Silicon): Download `voicevox_engine-macos-arm64-*.7z.001`
   - Extract with `7z x filename.7z.001` (install 7z via `brew install p7zip`)
3. **Anthropic API Key** - Get from [console.anthropic.com](https://console.anthropic.com/settings/keys)
4. **Chrome/Edge** - Required for Web Speech API (Japanese STT)

### Setup

```bash
# Install dependencies
npm install

# Start VOICEVOX (in a separate terminal)
# Navigate to your extracted VOICEVOX directory and run:
./run

# Start the app
npm run dev
```

### First Run

1. Open http://localhost:5173 in Chrome
2. Enter your Anthropic API key when prompted
3. Make sure VOICEVOX is running at localhost:50021
4. Click "Start Conversation" and begin speaking Japanese!

## Features

- **AI Conversation Partner**: Claude acts as a native Japanese speaker in various scenarios
- **Speech Recognition**: Speak in Japanese using your microphone (Web Speech API)
- **Text-to-Speech**: Natural Japanese voice via VOICEVOX (Shikoku Metan by default)
- **Adaptive Scenarios**: Practice real-life situations (restaurants, convenience stores, etc.)
- **Session Feedback**: Grammar corrections, vocabulary review, fluency notes (coming soon)
- **SRS Vocabulary**: Spaced repetition for words learned in conversations (coming soon)

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | Vite + React + TypeScript |
| UI | Tailwind CSS + shadcn/ui |
| AI | Claude API (claude-sonnet-4-6) |
| TTS | VOICEVOX (localhost:50021) |
| STT | Web Speech API |
| Storage | localStorage |

## Project Structure

```
src/
  components/
    ui/              # shadcn components
    conversation/    # Conversation screen
    flashcard/       # SRS review (coming soon)
  hooks/             # Custom React hooks
  services/          # API clients (Claude, VOICEVOX, storage)
  types/             # TypeScript types
  lib/               # Utilities
```

## Development

```bash
npm run dev      # Start dev server
npm run build    # Build for production
npm run preview  # Preview production build
```

## License

MIT
