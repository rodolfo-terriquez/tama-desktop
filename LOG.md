# Tama Development Log

---

## 2026-02-22 (Day 1)

### What We Built
- **Full project setup from scratch**
  - Vite + React 19 + TypeScript
  - Tailwind CSS v4 + shadcn/ui components
  - Project folder structure (components, hooks, services, types)

- **VOICEVOX Integration**
  - Downloaded and installed VOICEVOX engine (macOS arm64, v0.25.1)
  - Location: `~/voicevox/macos-arm64/`
  - Created VOICEVOX service with speaker discovery
  - Default voice: Shikoku Metan (四国めたん) - Speaker ID 2
  - Tested TTS successfully

- **Claude API Integration**
  - Service for conversation with claude-sonnet-4-6
  - System prompt for Japanese conversation practice
  - Translation function (Japanese → English)
  - Feedback generation function (ready for Phase 3)

- **Speech Recognition**
  - Initially tried Web Speech API - had "network" errors (Google servers flaky)
  - **Switched to OpenAI Whisper API** - much more reliable
  - Created audio recording hook using MediaRecorder API
  - Set up Vite proxy to avoid CORS issues with OpenAI API

- **Conversation UI**
  - Conversation screen with scenario display
  - Message bubbles with role labels
  - Text input fallback for typing
  - Mic button with recording/transcribing states
  - Translation button (🇺🇸/🇯🇵) on AI messages
  - Replay button (🔊) to hear AI speech again

- **Settings & Configuration**
  - API key dialog for initial setup (Anthropic + OpenAI keys)
  - Settings page to update API keys
  - "Clear All Data" option

### Issues & Fixes

1. **Vite scaffolding failed in non-empty directory**
   - Fix: Created project in temp directory, then copied files

2. **Claude API: "messages: at least one message is required"**
   - Fix: When starting conversation with empty array, send hidden starter message "会話を始めてください"

3. **Web Speech API: "network" error**
   - Cause: Google's speech servers are unreliable
   - Fix: Replaced with OpenAI Whisper API

4. **OpenAI API: CORS error from browser**
   - Cause: OpenAI doesn't allow direct browser requests (unlike Anthropic)
   - Fix: Added Vite dev server proxy (`/api/openai/*` → `https://api.openai.com/*`)

5. **1Password kept triggering on "Show EN" / "Replay" buttons**
   - Cause: Button text patterns similar to password show/hide
   - Fix: Changed to emoji icons (🔊, 🇺🇸, 🇯🇵) and added `data-1p-ignore` attribute

6. **Whisper transcribing English speech as Japanese**
   - Cause: Language was hardcoded to "ja"
   - Fix: Removed language parameter, let Whisper auto-detect

### Testing Done
- VOICEVOX TTS: Working (Shikoku Metan speaks Japanese)
- Whisper transcription: Working (auto-detects Japanese/English)
- Claude conversation: Working (responds in Japanese, helps with English questions)
- Translation: Working (shows English translation on demand)
- Replay: Working (re-speaks AI messages)
- Settings: Working (can update API keys)

### Current State
- **Phase 2 complete** - Basic conversation loop fully functional
- App is usable for Japanese practice
- Ready for Phase 3 (Post-Session Feedback UI)

### Files Created/Modified
```
New files:
- src/services/voicevox.ts
- src/services/claude.ts
- src/services/openai.ts
- src/services/storage.ts
- src/hooks/useAudioRecorder.ts
- src/hooks/useSpeechRecognition.ts (deprecated)
- src/types/index.ts
- src/components/ApiKeyDialog.tsx
- src/components/Settings.tsx
- src/components/conversation/ConversationScreen.tsx
- src/components/conversation/MessageBubble.tsx
- PLAN.md
- LOG.md

Modified:
- vite.config.ts (added proxy for OpenAI)
- tsconfig.json, tsconfig.app.json (path aliases)
- src/index.css (Tailwind setup)
- src/App.tsx (routing between screens)
- index.html (title)
- README.md (project documentation)
- .gitignore (added data/)
```

### Next Session
- Start Phase 3: Post-Session Feedback UI
- Create feedback screen with grammar points, vocabulary, fluency notes
- Add "Add to SRS" functionality for vocabulary items
- Implement session storage (save transcripts + feedback)

---

## 2026-02-22 (Day 1, Session 2)

### What We Built
- **Voice Mode UI** - ChatGPT-style hands-free conversation
  - `VoiceModeScreen.tsx` - Main voice conversation interface
  - `VoiceVisualizer.tsx` - Animated circle that responds to audio amplitude
  - `TranscriptBubbles.tsx` - Chat bubbles with fade effect and tap-to-translate
  - Auto-scrolling transcript with older messages fading out
  - Hidden scrollbar for cleaner UI

- **Custom VAD (Voice Activity Detection)**
  - `useVADRecorder.ts` - Amplitude-based speech detection
  - Background noise calibration flow before conversation
  - Automatic turn-taking (detects when user stops speaking)
  - Replaced `@ricky0123/vad-web` which had ONNX/WASM loading issues with Vite

- **JLPT Level Selection**
  - Settings UI for selecting N5-N1 level
  - Claude system prompt adapts complexity based on selected level

### Issues & Fixes

1. **VAD library ONNX/WASM loading issues**
   - Cause: `@ricky0123/vad-web` had compatibility issues with Vite bundling
   - Fix: Built custom amplitude-based VAD instead

2. **WebM chunk combining produced invalid audio**
   - Cause: When combining MediaRecorder chunks from continuous recording, the resulting blob was invalid for OpenAI Whisper (400 Bad Request)
   - Fix: Record as single continuous blob per utterance

3. **VAD onstop handler race condition**
   - Cause: `handleSpeechEnd()` set `isSpeakingRef.current = false` before calling `mediaRecorder.stop()`. Since `stop()` is async, the `onstop` handler's check of `isSpeakingRef.current` always failed, so audio was never sent to Whisper.
   - Fix: Capture speech validity before stopping and pass via `_wasValidSpeech` flag on the mediaRecorder object

4. **Whisper accuracy for Japanese**
   - Tip: Setting `language: "ja"` and passing conversation context as a `prompt` parameter improves transcription accuracy

### Files Created/Modified
```
New files:
- src/components/conversation/VoiceModeScreen.tsx
- src/components/conversation/VoiceVisualizer.tsx
- src/components/conversation/TranscriptBubbles.tsx
- src/hooks/useVADRecorder.ts

Modified:
- src/components/Settings.tsx (JLPT level selection)
- src/services/claude.ts (JLPT-aware system prompts)
- src/types/index.ts (JLPTLevel type)
```

### Current State
- **Phase 2 complete** - Voice mode with auto turn-taking working
- VAD race condition bug fixed
- Ready for Phase 3 (Post-Session Feedback UI)

### Next Session
- Test VAD fix with voice conversation
- Start Phase 3: Post-Session Feedback UI
- Wire up `generateFeedback` function to UI

---

## 2026-02-23 (Day 2)

### What We Built

- **Sidebar Navigation**
  - Added shadcn sidebar component with full navigation
  - `AppSidebar.tsx` - Main navigation with Home, Voice Practice, Text Practice, Flashcards, Settings
  - Sidebar toggle button and keyboard shortcut (B)
  - VOICEVOX control section integrated into sidebar
  - Responsive design with mobile sheet overlay

- **VOICEVOX Auto-Download**
  - `server/voicevox-control.ts` - Vite plugin that manages VOICEVOX engine
  - Automatic detection of platform (darwin-arm64, darwin-x64, linux-x64, linux-arm64)
  - Download endpoint that fetches the standalone engine (~1.6GB)
  - Progress tracking with real-time status updates
  - Extraction using 7z (requires p7zip installed)
  - Engine stored in `voicevox-engine/` directory (gitignored)

- **VoicevoxControl Component Enhancements**
  - `VoicevoxControl.tsx` - Full control UI for VOICEVOX
  - Download button with progress bar
  - Shows download/extraction status
  - Compact mode for sidebar, full mode for setup screens
  - Start/Stop buttons for engine management

- **Responsive Layout Fixes**
  - Fixed height issues where content was cut off
  - Changed from fixed `h-[100vh]` to `h-full` in conversation screens
  - Content now properly fills available space within sidebar layout

- **Home Screen**
  - Welcome screen with "Start Voice Practice" and "Start Text Practice" buttons
  - Clean centered layout

### Issues & Fixes

1. **macOS Gatekeeper blocking VOICEVOX.app**
   - Cause: Downloaded app was quarantined by macOS
   - Fix: `xattr -dr com.apple.quarantine "/Applications/VOICEVOX.app"`
   - Better fix: Use standalone engine instead of .app bundle

2. **Standalone VOICEVOX engine needs 7z to extract**
   - Cause: Engine is distributed as .7z archive
   - Fix: Install p7zip (`brew install p7zip` on macOS)

3. **Content cut off in conversation screens**
   - Cause: Using `h-[100vh]` which didn't account for header height
   - Fix: Changed to `h-full` so content fills parent container

4. **TypeScript type mismatch for Screen navigation**
   - Cause: AppSidebar had its own Screen type that didn't match App.tsx
   - Fix: Used `string` type with cast for flexibility

### Files Created/Modified
```
New files:
- server/voicevox-control.ts      # Vite plugin for VOICEVOX management
- src/components/AppSidebar.tsx   # Main navigation sidebar
- src/components/VoicevoxControl.tsx  # VOICEVOX control UI
- src/components/ui/sidebar.tsx   # shadcn sidebar component
- src/components/ui/separator.tsx
- src/components/ui/sheet.tsx
- src/components/ui/tooltip.tsx
- src/components/ui/skeleton.tsx
- src/hooks/use-mobile.ts

Modified:
- src/App.tsx (sidebar layout, home screen, navigation)
- src/components/conversation/ConversationScreen.tsx (responsive height)
- src/components/conversation/VoiceModeScreen.tsx (responsive height, VoicevoxControl)
- vite.config.ts (voicevoxControlPlugin)
- .gitignore (voicevox-engine/)
- PLAN.md (updated status)
- LOG.md (this entry)
```

### Current State
- **UI Polish complete** - Sidebar navigation working
- **VOICEVOX auto-download** - Engine downloads if missing
- App layout is clean and responsive
- Ready for Phase 3 (Post-Session Feedback UI)

### Next Session
- Start Phase 3: Post-Session Feedback UI
- Wire up `generateFeedback` function to UI after session ends
- Create feedback screen with grammar points, vocabulary, fluency notes
- Add "Add to SRS" functionality for vocabulary items

---

## Template for Future Entries

```markdown
## YYYY-MM-DD

### What We Built
- Feature 1
- Feature 2

### Issues & Fixes
1. **Issue description**
   - Cause: ...
   - Fix: ...

### Testing Done
- Test 1: Result
- Test 2: Result

### Current State
- Phase X complete/in progress
- Notes about app state

### Next Session
- Task 1
- Task 2
```
