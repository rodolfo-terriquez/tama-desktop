import Database from "@tauri-apps/plugin-sql";
import type {
  AccountBundleV1,
  FlashcardReviewSession,
  OngoingChat,
  Scenario,
  ShadowScript,
  SenseiThread,
  Session,
  UserProfile,
  VocabItem,
} from "@/types";

// ── DB singleton ────────────────────────────────────────────────────

let db: Database | null = null;

async function getDb(): Promise<Database> {
  if (!db) {
    db = await Database.load("sqlite:tama.db");
    await migrateLocalStorage(db);
  }
  return db;
}

// ── Defaults ────────────────────────────────────────────────────────

const DEFAULT_USER_PROFILE: UserProfile = {
  jlpt_level: "N5",
  auto_adjust_level: false,
  estimated_level: "beginner",
  response_length: "natural",
  include_flashcard_vocab_in_conversations: true,
  interests: [],
  topics_covered: [],
  recent_struggles: [],
  total_sessions: 0,
};

// ── User Profile ────────────────────────────────────────────────────

interface ProfileRow {
  id: number;
  jlpt_level: string;
  auto_adjust_level: number;
  estimated_level: string;
  response_length: string;
  include_flashcard_vocab_in_conversations: number;
  user_name: string | null;
  age: number | null;
  about_you: string | null;
  interests: string;
  topics_covered: string;
  recent_struggles: string;
  total_sessions: number;
  voicevox_speaker_id: number | null;
  voicevox_speaker_name: string | null;
}

function rowToProfile(row: ProfileRow): UserProfile {
  return {
    jlpt_level: row.jlpt_level as UserProfile["jlpt_level"],
    auto_adjust_level: row.auto_adjust_level === 1,
    estimated_level: row.estimated_level as UserProfile["estimated_level"],
    response_length: row.response_length as UserProfile["response_length"],
    include_flashcard_vocab_in_conversations:
      row.include_flashcard_vocab_in_conversations === 1,
    name: row.user_name ?? undefined,
    age: row.age ?? undefined,
    aboutYou: row.about_you ?? undefined,
    interests: JSON.parse(row.interests || "[]"),
    topics_covered: JSON.parse(row.topics_covered || "[]"),
    recent_struggles: JSON.parse(row.recent_struggles || "[]"),
    total_sessions: row.total_sessions,
    voicevox_speaker_id: row.voicevox_speaker_id ?? undefined,
    voicevox_speaker_name: row.voicevox_speaker_name ?? undefined,
  };
}

export async function getUserProfile(): Promise<UserProfile> {
  const d = await getDb();
  const rows = await d.select<ProfileRow[]>("SELECT * FROM user_profile WHERE id = 1");
  if (rows.length > 0) return rowToProfile(rows[0]);
  return { ...DEFAULT_USER_PROFILE };
}

export async function saveUserProfile(profile: UserProfile): Promise<void> {
  const d = await getDb();
  await d.execute(
    `UPDATE user_profile SET
      jlpt_level = $1, auto_adjust_level = $2, estimated_level = $3,
      response_length = $4, include_flashcard_vocab_in_conversations = $5,
      user_name = $6, age = $7, about_you = $8,
      interests = $9, topics_covered = $10,
      recent_struggles = $11, total_sessions = $12,
      voicevox_speaker_id = $13, voicevox_speaker_name = $14
    WHERE id = 1`,
    [
      profile.jlpt_level,
      profile.auto_adjust_level ? 1 : 0,
      profile.estimated_level,
      profile.response_length,
      profile.include_flashcard_vocab_in_conversations ? 1 : 0,
      profile.name ?? null,
      profile.age ?? null,
      profile.aboutYou ?? null,
      JSON.stringify(profile.interests),
      JSON.stringify(profile.topics_covered),
      JSON.stringify(profile.recent_struggles),
      profile.total_sessions,
      profile.voicevox_speaker_id ?? null,
      profile.voicevox_speaker_name ?? null,
    ]
  );
}

export async function updateUserProfile(updates: Partial<UserProfile>): Promise<UserProfile> {
  const current = await getUserProfile();
  const updated = { ...current, ...updates };
  await saveUserProfile(updated);
  return updated;
}

// ── Vocabulary ──────────────────────────────────────────────────────

interface VocabRow {
  id: string;
  word: string;
  reading: string;
  meaning: string;
  example: string;
  source_session: string;
  interval_days: number;
  ease_factor: number;
  next_review: string;
  times_seen_in_conversation: number;
  times_reviewed: number;
}

function rowToVocab(row: VocabRow): VocabItem {
  return {
    id: row.id,
    word: row.word,
    reading: row.reading,
    meaning: row.meaning,
    example: row.example,
    source_session: row.source_session,
    interval: row.interval_days,
    ease_factor: row.ease_factor,
    next_review: row.next_review,
    times_seen_in_conversation: row.times_seen_in_conversation,
    times_reviewed: row.times_reviewed,
  };
}

export async function getVocabulary(): Promise<VocabItem[]> {
  const d = await getDb();
  const rows = await d.select<VocabRow[]>("SELECT * FROM vocab_items");
  return rows.map(rowToVocab);
}

export async function addVocabItem(
  item: Omit<VocabItem, "id" | "interval" | "ease_factor" | "next_review" | "times_seen_in_conversation" | "times_reviewed">
): Promise<VocabItem> {
  const d = await getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString().split("T")[0];
  await d.execute(
    `INSERT INTO vocab_items (id, word, reading, meaning, example, source_session, interval_days, ease_factor, next_review, times_seen_in_conversation, times_reviewed)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [id, item.word, item.reading, item.meaning, item.example, item.source_session, 1, 2.5, now, 0, 0]
  );
  return {
    ...item,
    id,
    interval: 1,
    ease_factor: 2.5,
    next_review: now,
    times_seen_in_conversation: 0,
    times_reviewed: 0,
  };
}

export async function updateVocabItem(id: string, updates: Partial<VocabItem>): Promise<VocabItem | null> {
  const d = await getDb();
  const rows = await d.select<VocabRow[]>("SELECT * FROM vocab_items WHERE id = $1", [id]);
  if (rows.length === 0) return null;

  const current = rowToVocab(rows[0]);
  const updated = { ...current, ...updates };

  await d.execute(
    `UPDATE vocab_items SET
      word = $1, reading = $2, meaning = $3, example = $4, source_session = $5,
      interval_days = $6, ease_factor = $7, next_review = $8,
      times_seen_in_conversation = $9, times_reviewed = $10
    WHERE id = $11`,
    [
      updated.word, updated.reading, updated.meaning, updated.example,
      updated.source_session, updated.interval, updated.ease_factor,
      updated.next_review, updated.times_seen_in_conversation,
      updated.times_reviewed, id,
    ]
  );
  return updated;
}

export async function deleteVocabItem(id: string): Promise<boolean> {
  const d = await getDb();
  const result = await d.execute("DELETE FROM vocab_items WHERE id = $1", [id]);
  return result.rowsAffected > 0;
}

export async function getDueVocabulary(limit?: number): Promise<VocabItem[]> {
  const d = await getDb();
  const today = new Date().toISOString().split("T")[0];
  let sql = "SELECT * FROM vocab_items WHERE next_review <= $1 ORDER BY next_review ASC";
  const params: unknown[] = [today];
  if (limit) {
    sql += " LIMIT $2";
    params.push(limit);
  }
  const rows = await d.select<VocabRow[]>(sql, params);
  return rows.map(rowToVocab);
}

// ── Sessions ────────────────────────────────────────────────────────

interface SessionRow {
  id: string;
  date: string;
  scenario: string;
  messages: string;
  feedback: string | null;
  duration_seconds: number;
  run_mode: string | null;
}

function rowToSession(row: SessionRow): Session {
  const runMode =
    row.run_mode === "shadow" || row.run_mode === "conversation" ? row.run_mode : undefined;
  return {
    id: row.id,
    date: row.date,
    scenario: JSON.parse(row.scenario),
    messages: JSON.parse(row.messages),
    feedback: row.feedback ? JSON.parse(row.feedback) : null,
    duration_seconds: row.duration_seconds,
    run_mode: runMode,
  };
}

function isOngoingChatSession(session: Session): boolean {
  return session.scenario.id.startsWith("ongoing-chat:");
}

export async function getSessions(): Promise<Session[]> {
  const d = await getDb();
  const rows = await d.select<SessionRow[]>("SELECT * FROM sessions ORDER BY date DESC");
  return rows.map(rowToSession);
}

export async function saveSession(session: Session): Promise<void> {
  const d = await getDb();
  await d.execute(
    `INSERT OR REPLACE INTO sessions (id, date, scenario, messages, feedback, duration_seconds, run_mode)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      session.id,
      session.date,
      JSON.stringify(session.scenario),
      JSON.stringify(session.messages),
      session.feedback ? JSON.stringify(session.feedback) : null,
      session.duration_seconds,
      session.run_mode ?? "conversation",
    ]
  );
}

export async function getLastSession(): Promise<Session | null> {
  const d = await getDb();
  const rows = await d.select<SessionRow[]>("SELECT * FROM sessions ORDER BY date DESC");
  const sessions = rows.map(rowToSession);
  return sessions.find((session) => !isOngoingChatSession(session)) ?? null;
}

// ── Flashcard Review Sessions ───────────────────────────────────────

interface FlashcardReviewSessionRow {
  id: string;
  date: string;
  duration_seconds: number;
  results: string;
}

function rowToFlashcardReviewSession(row: FlashcardReviewSessionRow): FlashcardReviewSession {
  return {
    id: row.id,
    date: row.date,
    duration_seconds: row.duration_seconds,
    results: JSON.parse(row.results || "[]"),
  };
}

export async function getFlashcardReviewSessions(): Promise<FlashcardReviewSession[]> {
  const d = await getDb();
  const rows = await d.select<FlashcardReviewSessionRow[]>(
    "SELECT * FROM flashcard_review_sessions ORDER BY date DESC"
  );
  return rows.map(rowToFlashcardReviewSession);
}

export async function saveFlashcardReviewSession(session: FlashcardReviewSession): Promise<void> {
  const d = await getDb();
  await d.execute(
    `INSERT OR REPLACE INTO flashcard_review_sessions (id, date, duration_seconds, results)
     VALUES ($1, $2, $3, $4)`,
    [session.id, session.date, session.duration_seconds, JSON.stringify(session.results)]
  );
}

// ── Custom Scenarios ────────────────────────────────────────────────

interface ScenarioRow {
  id: string;
  title: string;
  title_ja: string;
  description: string;
  setting: string;
  character_role: string;
  objectives: string;
  custom_prompt: string | null;
}

function rowToScenario(row: ScenarioRow): Scenario {
  return {
    id: row.id,
    title: row.title,
    title_ja: row.title_ja,
    description: row.description,
    setting: row.setting,
    character_role: row.character_role,
    objectives: JSON.parse(row.objectives || "[]"),
    isCustom: true,
    custom_prompt: row.custom_prompt ?? undefined,
  };
}

export async function getCustomScenarios(): Promise<Scenario[]> {
  const d = await getDb();
  const rows = await d.select<ScenarioRow[]>("SELECT * FROM custom_scenarios");
  return rows.map(rowToScenario);
}

export async function addCustomScenario(
  scenario: Omit<Scenario, "id" | "isCustom">
): Promise<Scenario> {
  const d = await getDb();
  const id = `custom_${crypto.randomUUID()}`;
  await d.execute(
    `INSERT INTO custom_scenarios (id, title, title_ja, description, setting, character_role, objectives, custom_prompt)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id, scenario.title, scenario.title_ja, scenario.description,
      scenario.setting, scenario.character_role,
      JSON.stringify(scenario.objectives), scenario.custom_prompt ?? null,
    ]
  );
  return { ...scenario, id, isCustom: true };
}

export async function updateCustomScenario(
  id: string,
  updates: Partial<Omit<Scenario, "id" | "isCustom">>
): Promise<Scenario | null> {
  const d = await getDb();
  const rows = await d.select<ScenarioRow[]>("SELECT * FROM custom_scenarios WHERE id = $1", [id]);
  if (rows.length === 0) return null;

  const current = rowToScenario(rows[0]);
  const updated = { ...current, ...updates };

  await d.execute(
    `UPDATE custom_scenarios SET
      title = $1, title_ja = $2, description = $3, setting = $4,
      character_role = $5, objectives = $6, custom_prompt = $7
    WHERE id = $8`,
    [
      updated.title, updated.title_ja, updated.description, updated.setting,
      updated.character_role, JSON.stringify(updated.objectives),
      updated.custom_prompt ?? null, id,
    ]
  );
  return updated;
}

export async function deleteCustomScenario(id: string): Promise<boolean> {
  const d = await getDb();
  const result = await d.execute("DELETE FROM custom_scenarios WHERE id = $1", [id]);
  return result.rowsAffected > 0;
}

// ── Shadow Scripts ──────────────────────────────────────────────────

interface ShadowScriptRow {
  id: string;
  scenario_id: string;
  generated_at: string;
  turns: string;
  focus_phrases: string;
}

function rowToShadowScript(row: ShadowScriptRow): ShadowScript {
  return {
    id: row.id,
    scenarioId: row.scenario_id,
    generatedAt: row.generated_at,
    turns: JSON.parse(row.turns || "[]"),
    focusPhrases: JSON.parse(row.focus_phrases || "[]"),
  };
}

export async function getShadowScript(scenarioId: string): Promise<ShadowScript | null> {
  const d = await getDb();
  const rows = await d.select<ShadowScriptRow[]>(
    "SELECT * FROM shadow_scripts WHERE scenario_id = $1 ORDER BY datetime(generated_at) DESC LIMIT 1",
    [scenarioId]
  );
  return rows.length > 0 ? rowToShadowScript(rows[0]) : null;
}

export async function saveShadowScript(script: ShadowScript): Promise<void> {
  const d = await getDb();
  await d.execute(
    `INSERT OR REPLACE INTO shadow_scripts (id, scenario_id, generated_at, turns, focus_phrases)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      script.id,
      script.scenarioId,
      script.generatedAt,
      JSON.stringify(script.turns),
      JSON.stringify(script.focusPhrases),
    ]
  );
}

export async function deleteShadowScript(scenarioId: string): Promise<boolean> {
  const d = await getDb();
  const result = await d.execute("DELETE FROM shadow_scripts WHERE scenario_id = $1", [scenarioId]);
  return result.rowsAffected > 0;
}

// ── Ongoing Chats ───────────────────────────────────────────────────

interface ChatRow {
  id: string;
  name: string;
  persona: string;
  messages: string;
  summary: string;
  created_at: string;
  last_active_at: string;
  total_messages: number;
  last_feedback_at_total: number;
}

function rowToChat(row: ChatRow): OngoingChat {
  return {
    id: row.id,
    name: row.name,
    persona: row.persona,
    messages: JSON.parse(row.messages || "[]"),
    summary: row.summary,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
    totalMessages: row.total_messages,
    lastFeedbackAtTotal: row.last_feedback_at_total,
  };
}

export async function getOngoingChats(): Promise<OngoingChat[]> {
  const d = await getDb();
  const rows = await d.select<ChatRow[]>("SELECT * FROM ongoing_chats ORDER BY last_active_at DESC");
  return rows.map(rowToChat);
}

export async function getOngoingChat(id: string): Promise<OngoingChat | null> {
  const d = await getDb();
  const rows = await d.select<ChatRow[]>("SELECT * FROM ongoing_chats WHERE id = $1", [id]);
  return rows.length > 0 ? rowToChat(rows[0]) : null;
}

export async function saveOngoingChat(chat: OngoingChat): Promise<void> {
  const d = await getDb();
  await d.execute(
    `INSERT OR REPLACE INTO ongoing_chats (id, name, persona, messages, summary, created_at, last_active_at, total_messages, last_feedback_at_total)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      chat.id, chat.name, chat.persona, JSON.stringify(chat.messages),
      chat.summary, chat.createdAt, chat.lastActiveAt,
      chat.totalMessages, chat.lastFeedbackAtTotal,
    ]
  );
}

export async function createOngoingChat(name: string, persona: string): Promise<OngoingChat> {
  const chat: OngoingChat = {
    id: crypto.randomUUID(),
    name,
    persona,
    messages: [],
    summary: "",
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    totalMessages: 0,
    lastFeedbackAtTotal: 0,
  };
  await saveOngoingChat(chat);
  return chat;
}

export async function updateOngoingChatMeta(
  id: string,
  updates: Partial<Pick<OngoingChat, "name" | "persona">>
): Promise<OngoingChat | null> {
  const chat = await getOngoingChat(id);
  if (!chat) return null;
  const updated = { ...chat, ...updates };
  await saveOngoingChat(updated);
  return updated;
}

export async function deleteOngoingChat(id: string): Promise<boolean> {
  const d = await getDb();
  const result = await d.execute("DELETE FROM ongoing_chats WHERE id = $1", [id]);
  return result.rowsAffected > 0;
}

// ── Sensei thread ───────────────────────────────────────────────────

interface SenseiRow {
  id: string;
  messages: string;
  summary: string;
  created_at: string;
  last_active_at: string;
  total_messages: number;
}

function rowToSenseiThread(row: SenseiRow): SenseiThread {
  return {
    id: row.id,
    messages: JSON.parse(row.messages || "[]"),
    summary: row.summary,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
    totalMessages: row.total_messages,
  };
}

export async function getSenseiThread(id = "global"): Promise<SenseiThread | null> {
  const d = await getDb();
  const rows = await d.select<SenseiRow[]>("SELECT * FROM sensei_threads WHERE id = $1", [id]);
  return rows.length > 0 ? rowToSenseiThread(rows[0]) : null;
}

export async function getSenseiThreads(): Promise<SenseiThread[]> {
  const d = await getDb();
  const rows = await d.select<SenseiRow[]>(
    "SELECT * FROM sensei_threads ORDER BY datetime(last_active_at) DESC, datetime(created_at) DESC"
  );
  return rows.map(rowToSenseiThread);
}

export async function saveSenseiThread(thread: SenseiThread): Promise<void> {
  const d = await getDb();
  await d.execute(
    `INSERT OR REPLACE INTO sensei_threads (id, messages, summary, created_at, last_active_at, total_messages)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      thread.id,
      JSON.stringify(thread.messages),
      thread.summary,
      thread.createdAt,
      thread.lastActiveAt,
      thread.totalMessages,
    ]
  );
}

export async function deleteSenseiThread(id: string): Promise<boolean> {
  const d = await getDb();
  const result = await d.execute("DELETE FROM sensei_threads WHERE id = $1", [id]);
  return result.rowsAffected > 0;
}

// ── Clear All Data ──────────────────────────────────────────────────

export async function clearAllData(): Promise<void> {
  const d = await getDb();
  await d.execute("DELETE FROM vocab_items");
  await d.execute("DELETE FROM sessions");
  await d.execute("DELETE FROM flashcard_review_sessions");
  await d.execute("DELETE FROM custom_scenarios");
  await d.execute("DELETE FROM shadow_scripts");
  await d.execute("DELETE FROM ongoing_chats");
  await d.execute("DELETE FROM sensei_threads");
  await d.execute("UPDATE user_profile SET jlpt_level='N5', auto_adjust_level=0, estimated_level='beginner', response_length='natural', include_flashcard_vocab_in_conversations=1, user_name=NULL, age=NULL, about_you=NULL, interests='[]', topics_covered='[]', recent_struggles='[]', total_sessions=0, voicevox_speaker_id=NULL, voicevox_speaker_name=NULL WHERE id=1");
}

export async function replaceAccountBundle(bundle: AccountBundleV1): Promise<void> {
  const d = await getDb();
  await d.execute("BEGIN");

  try {
    const profile = bundle.profile;

    await d.execute("DELETE FROM vocab_items");
    await d.execute("DELETE FROM sessions");
    await d.execute("DELETE FROM flashcard_review_sessions");
    await d.execute("DELETE FROM custom_scenarios");
    await d.execute("DELETE FROM shadow_scripts");
    await d.execute("DELETE FROM ongoing_chats");
    await d.execute("DELETE FROM sensei_threads");

    await d.execute(
      `UPDATE user_profile SET
        jlpt_level = $1, auto_adjust_level = $2, estimated_level = $3,
        response_length = $4, include_flashcard_vocab_in_conversations = $5,
        user_name = $6, age = $7, about_you = $8,
        interests = $9, topics_covered = $10, recent_struggles = $11,
        total_sessions = $12, voicevox_speaker_id = $13, voicevox_speaker_name = $14
      WHERE id = 1`,
      [
        profile.jlpt_level,
        profile.auto_adjust_level ? 1 : 0,
        profile.estimated_level,
        profile.response_length,
        profile.include_flashcard_vocab_in_conversations ? 1 : 0,
        profile.name ?? null,
        profile.age ?? null,
        profile.aboutYou ?? null,
        JSON.stringify(profile.interests),
        JSON.stringify(profile.topics_covered),
        JSON.stringify(profile.recent_struggles),
        profile.total_sessions,
        profile.voicevox_speaker_id ?? null,
        profile.voicevox_speaker_name ?? null,
      ]
    );

    for (const item of bundle.vocabulary) {
      await d.execute(
        `INSERT INTO vocab_items (id, word, reading, meaning, example, source_session, interval_days, ease_factor, next_review, times_seen_in_conversation, times_reviewed)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          item.id,
          item.word,
          item.reading,
          item.meaning,
          item.example,
          item.source_session,
          item.interval,
          item.ease_factor,
          item.next_review,
          item.times_seen_in_conversation,
          item.times_reviewed,
        ]
      );
    }

    for (const session of bundle.sessions) {
      await d.execute(
        `INSERT INTO sessions (id, date, scenario, messages, feedback, duration_seconds, run_mode)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          session.id,
          session.date,
          JSON.stringify(session.scenario),
          JSON.stringify(session.messages),
          session.feedback ? JSON.stringify(session.feedback) : null,
          session.duration_seconds,
          session.run_mode ?? "conversation",
        ]
      );
    }

    for (const scenario of bundle.customScenarios) {
      await d.execute(
        `INSERT INTO custom_scenarios (id, title, title_ja, description, setting, character_role, objectives, custom_prompt)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          scenario.id,
          scenario.title,
          scenario.title_ja,
          scenario.description,
          scenario.setting,
          scenario.character_role,
          JSON.stringify(scenario.objectives),
          scenario.custom_prompt ?? null,
        ]
      );
    }

    for (const chat of bundle.ongoingChats) {
      await d.execute(
        `INSERT INTO ongoing_chats (id, name, persona, messages, summary, created_at, last_active_at, total_messages, last_feedback_at_total)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          chat.id,
          chat.name,
          chat.persona,
          JSON.stringify(chat.messages),
          chat.summary,
          chat.createdAt,
          chat.lastActiveAt,
          chat.totalMessages,
          chat.lastFeedbackAtTotal,
        ]
      );
    }

    const threads = bundle.senseiThreads ?? (bundle.sensei ? [bundle.sensei] : []);

    for (const thread of threads) {
      await d.execute(
        `INSERT INTO sensei_threads (id, messages, summary, created_at, last_active_at, total_messages)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          thread.id,
          JSON.stringify(thread.messages),
          thread.summary,
          thread.createdAt,
          thread.lastActiveAt,
          thread.totalMessages,
        ]
      );
    }

    await d.execute("COMMIT");
  } catch (error) {
    await d.execute("ROLLBACK");
    throw error;
  }
}

// ── localStorage → SQLite migration ─────────────────────────────────

const LS_MIGRATION_KEY = "tama_sqlite_migrated";

const OLD_KEYS = {
  USER_PROFILE: "tama_user_profile",
  VOCABULARY: "tama_vocabulary",
  SESSIONS: "tama_sessions",
  CUSTOM_SCENARIOS: "tama_custom_scenarios",
  ONGOING_CHATS: "tama_ongoing_chats",
};

async function migrateLocalStorage(d: Database): Promise<void> {
  if (localStorage.getItem(LS_MIGRATION_KEY)) return;

  let migrated = false;

  // Profile
  const profileJson = localStorage.getItem(OLD_KEYS.USER_PROFILE);
  if (profileJson) {
    try {
      const p = JSON.parse(profileJson) as UserProfile;
      await d.execute(
        `UPDATE user_profile SET
          jlpt_level=$1, auto_adjust_level=$2, estimated_level=$3,
          response_length=$4, include_flashcard_vocab_in_conversations=$5,
          user_name=$6, age=$7, about_you=$8,
          interests=$9, topics_covered=$10,
          recent_struggles=$11, total_sessions=$12,
          voicevox_speaker_id=$13, voicevox_speaker_name=$14
        WHERE id=1`,
        [
          p.jlpt_level, p.auto_adjust_level ? 1 : 0, p.estimated_level,
          p.response_length, p.include_flashcard_vocab_in_conversations === false ? 0 : 1,
          p.name ?? null, p.age ?? null, p.aboutYou ?? null,
          JSON.stringify(p.interests), JSON.stringify(p.topics_covered), JSON.stringify(p.recent_struggles),
          p.total_sessions, p.voicevox_speaker_id ?? null,
          p.voicevox_speaker_name ?? null,
        ]
      );
      migrated = true;
    } catch { /* skip bad data */ }
  }

  // Vocabulary
  const vocabJson = localStorage.getItem(OLD_KEYS.VOCABULARY);
  if (vocabJson) {
    try {
      const items = JSON.parse(vocabJson) as VocabItem[];
      for (const v of items) {
        await d.execute(
          `INSERT OR IGNORE INTO vocab_items (id, word, reading, meaning, example, source_session, interval_days, ease_factor, next_review, times_seen_in_conversation, times_reviewed)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [v.id, v.word, v.reading, v.meaning, v.example || "", v.source_session || "", v.interval, v.ease_factor, v.next_review, v.times_seen_in_conversation, v.times_reviewed]
        );
      }
      migrated = true;
    } catch { /* skip */ }
  }

  // Sessions
  const sessionsJson = localStorage.getItem(OLD_KEYS.SESSIONS);
  if (sessionsJson) {
    try {
      const sessions = JSON.parse(sessionsJson) as Session[];
      for (const s of sessions) {
        await d.execute(
          `INSERT OR IGNORE INTO sessions (id, date, scenario, messages, feedback, duration_seconds)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [s.id, s.date, JSON.stringify(s.scenario), JSON.stringify(s.messages), s.feedback ? JSON.stringify(s.feedback) : null, s.duration_seconds]
        );
      }
      migrated = true;
    } catch { /* skip */ }
  }

  // Custom Scenarios
  const scenariosJson = localStorage.getItem(OLD_KEYS.CUSTOM_SCENARIOS);
  if (scenariosJson) {
    try {
      const scenarios = JSON.parse(scenariosJson) as Scenario[];
      for (const sc of scenarios) {
        await d.execute(
          `INSERT OR IGNORE INTO custom_scenarios (id, title, title_ja, description, setting, character_role, objectives, custom_prompt)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [sc.id, sc.title, sc.title_ja, sc.description, sc.setting, sc.character_role, JSON.stringify(sc.objectives), sc.custom_prompt ?? null]
        );
      }
      migrated = true;
    } catch { /* skip */ }
  }

  // Ongoing Chats
  const chatsJson = localStorage.getItem(OLD_KEYS.ONGOING_CHATS);
  if (chatsJson) {
    try {
      const chats = JSON.parse(chatsJson) as OngoingChat[];
      for (const c of chats) {
        await d.execute(
          `INSERT OR IGNORE INTO ongoing_chats (id, name, persona, messages, summary, created_at, last_active_at, total_messages, last_feedback_at_total)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [c.id, c.name, c.persona, JSON.stringify(c.messages), c.summary, c.createdAt, c.lastActiveAt, c.totalMessages, c.lastFeedbackAtTotal]
        );
      }
      migrated = true;
    } catch { /* skip */ }
  }

  if (migrated) {
    console.log("Migrated localStorage data to SQLite");
  }

  // Mark migration as complete (even if there was no data — prevents re-checking)
  localStorage.setItem(LS_MIGRATION_KEY, "1");

  // Clean up old keys
  for (const key of Object.values(OLD_KEYS)) {
    localStorage.removeItem(key);
  }
}
