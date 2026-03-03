# Tama - Japanese Practice App Development Plan

## Overview

A local web app for Japanese conversation practice with adaptive AI scenarios, built-in SRS vocabulary, and VOICEVOX TTS.

---

## MVP Phases

### Phase 0: Project Setup
- [x] Initialize Vite + React + TypeScript
- [x] Install and configure Tailwind CSS v4
- [x] Initialize shadcn/ui and add base components
- [x] Set up project folder structure
- [x] Download and install VOICEVOX engine (macOS arm64)
- [x] **Auto-download VOICEVOX engine** - Downloads if missing (~1.6GB)
- [x] **Sidebar navigation** - shadcn sidebar with navigation and VOICEVOX control

### Phase 1: Core Integration (MVP Steps 1-2)
- [x] Create VOICEVOX service with speaker discovery
- [x] Test VOICEVOX TTS (Shikoku Metan working)
- [x] Create Claude API service
- [x] ~~Build Web Speech API hook~~ (replaced with Whisper)
- [x] Create audio recording hook (MediaRecorder API)
- [x] Create OpenAI Whisper service for transcription
- [x] Build basic conversation loop: Mic → Whisper → Claude → VOICEVOX
- [x] Create API key setup dialog (Anthropic + OpenAI)

### Phase 2: Conversation UX (MVP Step 3)
- [x] Scenario system with default "Self Introduction" scenario
- [x] Conversation screen with chat log
- [x] Text input fallback for typing
- [x] Mic button with recording states
- [x] Message bubbles with role labels
- [x] **Translation button** - "Show EN" to reveal English translation
- [x] **Replay button** - hear AI message again
- [x] Settings page for API key management

### Phase 3: Post-Session Feedback (MVP Step 4)
- [x] Feedback generation function (Claude service)
- [x] Feedback screen UI
  - [x] Grammar points display
  - [x] Vocabulary list with "Add to SRS" buttons
  - [x] Fluency notes
  - [x] Session summary with performance rating
- [x] Session storage (save transcripts + feedback)

### Phase 4: SRS Data Model (MVP Step 5)
- [x] Vocabulary types defined
- [x] Storage service (localStorage)
- [x] SM-2 algorithm implementation (`src/services/srs.ts`)
- [x] Add vocabulary from feedback (via FeedbackScreen "Add to SRS")
- [x] Due vocabulary calculation (`getDueVocabulary` in storage service)

### Phase 5: Claude Tool Integration (MVP Step 6)
- [x] Define Claude tools (`get_due_vocabulary`, `get_user_profile`)
- [x] Tool handler for processing Claude's tool calls
- [x] Integrate due vocabulary into scenario generation
- [x] Track vocabulary usage in conversations

### Phase 6: Flashcard Review UI (MVP Step 7)
- [x] Flashcard component (front/back with flip animation)
- [x] Review session screen
- [x] Rating buttons (Again / Hard / Good / Easy)
- [x] Progress indicator
- [x] Update SRS data after review

### Phase 7: User Profile & Adaptive Scenarios (MVP Step 8)
- [x] User profile types defined
- [x] Profile storage and updates (auto-updates after each session)
- [x] Multiple scenario options (12 scenarios)
- [x] Scenario selection based on:
  - [x] User interests
  - [x] Topics not recently covered
  - [x] Performance history
  - [x] Due vocabulary relevance

### Phase 8: Dashboard & Polish (MVP Step 9)
- [x] Dashboard / Home screen
  - [x] Due vocabulary count badge
  - [x] Start Conversation button (Browse Scenarios + Free Practice)
  - [x] Last session summary with performance rating
  - [x] Quick SRS review button (stats card links to flashcards)
- [x] **Sidebar navigation** with Home, Scenarios, Free Practice, Flashcards, History, Settings
- [x] **VOICEVOX control in sidebar** - Start/Stop/Download engine
- [x] VOICEVOX voice selection in settings (grouped by speaker with English names)
- [ ] Furigana rendering (future enhancement — requires heavy dictionary dependency)
- [x] Session history view with date, scenario, rating, duration, topics
- [x] Export vocabulary (Anki TSV format)

---

## Current Status

**Phase 8 Complete** - Dashboard & polish done (MVP complete):
- Speech input via Whisper API
- Claude conversation in Japanese
- VOICEVOX TTS output (Shikoku Metan)
- Translation and replay features
- Settings page for API keys
- **Sidebar navigation** with Home, Voice Practice, Text Practice, Flashcards
- **VOICEVOX auto-download** - Downloads engine if not installed
- **Responsive layout** - Content fills available space properly
- **Post-session feedback** - Grammar corrections, vocabulary with "Add to SRS", fluency notes, performance rating
- **Session storage** - Transcripts + feedback saved to localStorage
- **SM-2 SRS algorithm** - `calculateSM2` + `reviewVocabItem` ready for flashcard UI
- **Claude tool integration** - `get_due_vocabulary` and `get_user_profile` tools with automatic vocab tracking
- **Flashcard review** - Flip cards with SM-2 rating, progress bar, empty/completion states
- **12 scenarios** with adaptive selection based on recency, performance, and vocabulary
- **Profile auto-updates** - topics covered, struggles, session count after each session
- **Enhanced dashboard** - due vocab badge, session count, last session summary, quick review
- **Session history** - full list with dates, ratings, topics, duration
- **Anki export** - download vocabulary as TSV for Anki import

**MVP Complete!** All core features implemented.

---

## Post-MVP: Style-Bert-VITS2 TTS Engine

### Goal

Add Style-Bert-VITS2 (SBV2) as an alternative TTS engine alongside VOICEVOX. Let the user choose which engine to use in Settings.

### Why

- **Smaller footprint** — SBV2 models are ~200-500 MB vs VOICEVOX's 1.9 GB engine
- **Faster synthesis** — Single-step API (text → WAV) vs VOICEVOX's two-step (audio_query → synthesis)
- **Style control** — SBV2 has emotional expression styles with adjustable weight (e.g. "Happy" at 0.8)
- **Flexible** — Users who already run SBV2 for other projects can reuse it

### API Comparison

| | VOICEVOX | Style-Bert-VITS2 |
|---|---|---|
| **Default port** | `localhost:50021` | `localhost:5000` |
| **Synthesis** | 2-step: `POST /audio_query` → `POST /synthesis` | 1-step: `GET/POST /voice?text=...` |
| **List speakers** | `GET /speakers` | `GET /models/info` |
| **Speaker selection** | `speaker` (style ID) | `model_id` + `speaker_id` + `style` |
| **Output** | WAV audio | WAV audio |
| **Status check** | `GET /version` | `GET /status` |
| **Engine size** | ~1.9 GB | ~200-500 MB per model |
| **Extra features** | — | `style_weight`, `assist_text`, `sdp_ratio` |

### Implementation Plan

#### Step 1: TTS Engine Abstraction (`src/services/tts.ts`)
Create a common interface both engines implement:
```
TTSEngine {
  name: string
  checkStatus(): Promise<boolean>
  getSpeakers(): Promise<TTSSpeaker[]>
  synthesize(text: string, speakerId?: string): Promise<ArrayBuffer>
}
```
- `TTSSpeaker` normalizes both engines' speaker formats: `{ name, id, styles[] }`
- A `getTTSEngine()` function returns the active engine based on user preference
- Audio playback (Web Audio API, amplitude analysis, interruption) stays shared

#### Step 2: Refactor VOICEVOX into Engine Adapter (`src/services/tts-voicevox.ts`)
- Extract existing `voicevox.ts` synthesis logic into the `TTSEngine` interface
- Keep VOICEVOX auto-download and control (sidebar) unchanged
- `getSpeakers()` maps VOICEVOX's `speakers[].styles[]` to `TTSSpeaker` format

#### Step 3: Style-Bert-VITS2 Engine Adapter (`src/services/tts-sbv2.ts`)
- `checkStatus()` → `GET http://{host}:{port}/models/info` (success = running)
- `getSpeakers()` → `GET /models/info` → map `model_id + spk2id + style2id` to `TTSSpeaker`
- `synthesize()` → `GET /voice?text=...&model_id=X&speaker_id=Y&style=Z&language=JP`
- Configurable base URL (default `localhost:5000`)

#### Step 4: Settings UI Updates
- New "TTS Engine" section in Settings (before voice selection)
- Toggle between VOICEVOX and Style-Bert-VITS2
- SBV2-specific: configurable server URL field
- Voice selection list adapts to whichever engine is active
- "Test Voice" works with either engine

#### Step 5: Update Conversation Screens
- Replace direct `voicevox.ts` imports with `tts.ts` abstraction
- `speak()` calls go through the active engine
- `stopCurrentAudio()` stays the same (Web Audio API level)
- Sidebar VOICEVOX control remains but only shows when VOICEVOX is the active engine

### Checklist

- [x] Create `TTSEngine` interface and shared audio playback in `src/services/tts.ts`
- [x] Refactor VOICEVOX into `src/services/tts-voicevox.ts` implementing `TTSEngine`
- [x] Create `src/services/tts-sbv2.ts` implementing `TTSEngine`
- [x] Add engine preference to user profile / localStorage
- [x] Update Settings UI with engine toggle + SBV2 URL config
- [x] Update voice selection to work with active engine
- [x] Update conversation screens to use `tts.ts` abstraction
- [x] Update sidebar to conditionally show VOICEVOX control

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | Vite + React 19 + TypeScript |
| UI | Tailwind CSS v4 + shadcn/ui |
| AI (Conversation) | Claude API (claude-sonnet-4-6) |
| AI (Transcription) | OpenAI Whisper API |
| TTS | VOICEVOX (localhost:50021) or Style-Bert-VITS2 (configurable) |
| Storage | localStorage |

---

## File Structure

```
src/
├── components/
│   ├── ui/                    # shadcn components (button, card, sidebar, etc.)
│   ├── conversation/
│   │   ├── ConversationScreen.tsx  # Text-based conversation mode
│   │   ├── VoiceModeScreen.tsx     # Voice-based conversation mode
│   │   ├── MessageBubble.tsx
│   │   ├── TranscriptBubbles.tsx
│   │   └── VoiceVisualizer.tsx
│   ├── feedback/
│   │   └── FeedbackScreen.tsx     # Post-session feedback UI
│   ├── flashcard/
│   │   ├── Flashcard.tsx          # Flip card component
│   │   └── FlashcardReview.tsx    # Review session screen
│   ├── ApiKeyDialog.tsx
│   ├── HomeScreen.tsx          # Dashboard with stats + last session
│   ├── ScenarioPicker.tsx     # Scenario selection with recommendations
│   ├── SessionHistory.tsx     # Past sessions list + Anki export
│   ├── AppSidebar.tsx         # Main navigation sidebar
│   ├── Settings.tsx
│   └── VoicevoxControl.tsx    # VOICEVOX start/stop/download UI
├── hooks/
│   ├── useAudioRecorder.ts
│   ├── useVADRecorder.ts      # Voice Activity Detection
│   ├── useSpeechRecognition.ts  # (deprecated)
│   └── use-mobile.ts          # shadcn mobile detection
├── services/
│   ├── claude.ts              # Claude API + translation
│   ├── openai.ts              # Whisper transcription
│   ├── tts.ts                 # TTS engine abstraction + shared playback
│   ├── tts-voicevox.ts        # VOICEVOX engine adapter
│   ├── tts-sbv2.ts            # Style-Bert-VITS2 engine adapter
│   ├── voicevox.ts            # Legacy (kept for reference, no longer imported)
│   ├── storage.ts             # localStorage utilities
│   ├── srs.ts                 # SM-2 spaced repetition algorithm
│   ├── tools.ts               # Claude tool definitions + handlers
│   └── scenarios.ts           # Scenario recommendation engine
├── data/
│   └── scenarios.ts           # Scenario library (12 scenarios)
├── types/
│   └── index.ts               # TypeScript types
├── lib/
│   └── utils.ts               # shadcn utilities
├── App.tsx
├── main.tsx
└── index.css

server/
└── voicevox-control.ts        # Vite plugin for VOICEVOX management

voicevox-engine/               # Auto-downloaded VOICEVOX engine (gitignored)
└── macos-arm64/               # Platform-specific engine files
```

---

## Running the App

```bash
# Just start the app - VOICEVOX is managed from within
npm run dev
```

Open http://localhost:5173 in Chrome.

- If VOICEVOX engine is not installed, click **Download** in the sidebar (~1.6GB)
- Once installed, click **Start** to run the engine
- The engine runs headlessly (no GUI window)

---

## API Keys Required

1. **Anthropic API Key** (`sk-ant-...`) - For Claude conversation
2. **OpenAI API Key** (`sk-...`) - For Whisper transcription

Both are stored in localStorage and can be updated in Settings.
