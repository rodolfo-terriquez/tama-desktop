# Japanese Practice App — Spec

> A local web app for Japanese conversation practice with adaptive AI scenarios, built-in SRS vocabulary, and VOICEVOX TTS.

---

## Core Concept

Two tightly integrated modules:

1. **Conversation Practice** — AI-driven conversation in Japanese, adaptive to your level and interests
2. **Vocabulary SRS** — Words collected during conversations, reviewed in context via future sessions

The SRS feeds the conversation engine (Claude pulls due vocab words and weaves them into scenarios), and conversations feed the SRS (new vocabulary gets added after each session).

---

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Vite + React (local) | Fast, no server needed, easy to iterate |
| AI | Claude API (claude-sonnet-4-6) | Work covers cost, best reasoning |
| TTS | VOICEVOX (local server) | Free, natural Japanese, runs at localhost:50021 |
| STT | Web Speech API | Built into Chrome, handles Japanese well |
| Storage | Local JSON files | Simple, no DB needed, easy to inspect |

Run with `npm run dev`. VOICEVOX runs as a separate local process.

---

## Module 1: Conversation Practice

### Flow

1. App loads → checks for due vocabulary words → generates a scenario
2. User presses mic → speaks in Japanese (or English if stuck)
3. Web Speech API → transcribed text → sent to Claude
4. Claude responds in Japanese → VOICEVOX speaks it aloud
5. Repeat until user ends session
6. Claude generates structured feedback
7. New/struggled vocabulary added to SRS deck

### Claude's Role

Claude acts as a native Japanese speaker in the scenario. It has access to two tools:

- **`get_due_vocabulary(limit)`** — pulls words from SRS deck that are due for review; Claude incorporates these naturally into the conversation
- **`get_user_profile()`** — returns current level estimate, topics covered, interests, recent struggles

### Language Mode

- Claude responds **in Japanese by default**
- If user speaks in English (e.g. "How do I say 'I'd like a window seat'?"), Claude:
  1. Teaches the phrase in Japanese
  2. Continues the conversation naturally in Japanese
- Claude pushes complexity beyond the user's comfort zone — uses new grammar patterns, doesn't simplify vocabulary unnecessarily

### Scenario Generation

Before each session, Claude generates a scenario based on:
- **Daily life in Japan** topics (restaurant, konbini, doctor's office, izakaya, keigo at work, etc.)
- **Performance history** — if the user did well on restaurant vocab, escalate (e.g., make a complaint, handle a reservation mix-up)
- **User interests** — pulls from profile to personalize (e.g., if interested in manga, a bookstore scenario)
- **Due vocabulary** — scenario designed to naturally elicit those words

### Post-Session Feedback

Structured feedback card shown after each conversation:

```
Grammar Points
  - [issue] → [correction] → [explanation]

Vocabulary to Review
  - [word] [reading] — [meaning] → [added to SRS]

Fluency Notes
  - [natural phrasing alternatives, nuance notes]

Session Summary
  - Topics covered, rough performance rating, next session hint
```

---

## Module 2: Vocabulary SRS

### Data Model

Each vocabulary item:

```json
{
  "id": "uuid",
  "word": "予約",
  "reading": "よやく",
  "meaning": "reservation / appointment",
  "example": "予約をお願いしたいんですが。",
  "source_session": "2026-02-22",
  "interval": 1,
  "ease_factor": 2.5,
  "next_review": "2026-02-23",
  "times_seen_in_conversation": 2,
  "times_reviewed": 4
}
```

### SRS Algorithm

SM-2 (same as Anki):
- After rating (Again / Hard / Good / Easy), update interval and ease factor
- Due words surfaced to Claude before conversation generation

### Review via Conversation (Primary)

Claude pulls due words and weaves them into scenarios. If a word comes up naturally in conversation and the user uses it correctly → counts as a review. If not, Claude finds a moment to elicit it.

### Standalone Flashcard Review (Secondary)

Simple card flip UI for direct review when not doing a full conversation session. Shows word → user recalls → flips → rates (Again / Hard / Good / Easy).

---

## Data Files (Local JSON)

```
/data
  user-profile.json       # level, interests, topics covered
  vocabulary.json         # full SRS deck
  sessions/
    2026-02-22.json       # per-session logs with transcript + feedback
```

### user-profile.json shape

```json
{
  "estimated_level": "intermediate",
  "interests": ["manga", "cooking", "gaming"],
  "topics_covered": ["restaurant", "konbini", "self-intro"],
  "recent_struggles": ["て-form conjunctions", "keigo verbs"],
  "total_sessions": 12
}
```

---

## UI Screens

### 1. Home / Dashboard
- Due vocabulary count (badge)
- Start Conversation button
- Last session summary
- Quick SRS review button

### 2. Conversation Screen
- Scenario card at top (scene description)
- Chat log (Japanese text with furigana toggle)
- Mic button (hold to speak / tap to toggle)
- "End Session" button
- Live transcript of what was heard

### 3. Feedback Screen
- Grammar points, vocabulary, fluency notes
- One-click "Add to SRS" for any vocab item
- "Next Session" button

### 4. Flashcard Review Screen
- Card with word + reading
- Flip to reveal meaning + example
- Again / Hard / Good / Easy buttons

### 5. Progress Screen (nice-to-have later)
- Sessions over time
- Vocabulary growth
- Topics covered map

---

## MVP Scope

Build in this order:

1. VOICEVOX integration test (local server → speak a sentence)
2. Web Speech API → Claude → VOICEVOX basic loop (no scenario, no SRS)
3. Scenario generation with Claude (no SRS yet)
4. Post-session feedback
5. SRS data model + add vocabulary from feedback
6. `get_due_vocabulary` tool for Claude
7. Standalone flashcard review UI
8. User profile tracking + adaptive scenarios
9. Polish: furigana, UI, dashboard

---

## Open Questions / Future

- Furigana rendering (consider `kuroshiro` JS library)
- VOICEVOX voice selection (different characters for different scenario types?)
- Export vocabulary to Anki if ever wanted
- Mobile-friendly layout (not priority, this is desktop-local)
