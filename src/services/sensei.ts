import { v4 as uuidv4 } from "uuid";
import { getAppLocale } from "@/services/app-config";
import { getContextMessages, sendMessageWithTools, summarizeSenseiConversation } from "@/services/claude";
import { SENSEI_TOOLS } from "@/services/tools";
import {
  deleteSenseiThread,
  getCustomScenarios,
  getOngoingChats,
  getSenseiThread,
  getSenseiThreads,
  getSessions,
  getUserProfile,
  getVocabulary,
  saveSenseiThread,
} from "@/services/storage";
import type {
  AccountBundleV1,
  AppLocale,
  Message,
  SenseiRequestContext,
  SenseiThread,
  SenseiViewContext,
} from "@/types";

const SENSEI_ACTIVE_THREAD_KEY = "tama_sensei_active_thread_id";
const SENSEI_SUMMARIZE_THRESHOLD = 32;
const SENSEI_KEEP_AFTER_SUMMARIZE = 12;

type SenseiResponseLanguage = "English" | "Spanish" | "Japanese";

const JAPANESE_CHAR_REGEX = /[\u3040-\u30ff\u3400-\u9fff]/gu;
const LATIN_LETTER_REGEX = /[A-Za-z\u00c0-\u024f]/gu;
const SPANISH_SIGNAL_REGEX =
  /[¿¡áéíóúñü]|\b(?:hola|gracias|por favor|puedo|puedes|quiero|quieres|necesito|explica|explicar|ayuda|como|cómo|que|qué|estoy|estás|tengo|para|porque|por qué|donde|dónde|esto|esta|este|responde|idioma|habla|dime|tambien|también)\b/giu;

function getLocaleFallbackLanguage(locale: AppLocale): "English" | "Spanish" {
  return locale === "es" ? "Spanish" : "English";
}

function detectMessageLanguage(text: string): SenseiResponseLanguage | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const japaneseChars = trimmed.match(JAPANESE_CHAR_REGEX)?.length ?? 0;
  const latinLetters = trimmed.match(LATIN_LETTER_REGEX)?.length ?? 0;
  const spanishSignals = trimmed.match(SPANISH_SIGNAL_REGEX)?.length ?? 0;

  if (japaneseChars > 0 && (latinLetters === 0 || japaneseChars >= latinLetters)) {
    return "Japanese";
  }

  if (spanishSignals > 0) {
    return "Spanish";
  }

  if (latinLetters > 0) {
    return "English";
  }

  return null;
}

function detectPreferredSenseiLanguage(messages: Message[], locale: AppLocale): SenseiResponseLanguage {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") {
      continue;
    }

    const detected = detectMessageLanguage(message.content);
    if (detected) {
      return detected;
    }
  }

  return getLocaleFallbackLanguage(locale);
}

function formatViewContext(view: SenseiViewContext): string {
  return JSON.stringify(view, null, 2);
}

function formatSenseiMessageForModel(message: Message): Message {
  if (message.role !== "user") {
    return message;
  }

  return {
    ...message,
    content: `[User message timestamp: ${message.timestamp}]\n${message.content}`,
  };
}

function getCurrentDateTimeBlock(locale: AppLocale): string {
  const now = new Date();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const localeCode = locale === "es" ? "es-MX" : "en-US";
  const localDateTime = new Intl.DateTimeFormat(localeCode, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(now);

  return JSON.stringify(
    {
      iso: now.toISOString(),
      local: localDateTime,
      timeZone,
    },
    null,
    2
  );
}

function buildAccountSummary(bundle: Pick<AccountBundleV1, "profile" | "sessions" | "vocabulary" | "ongoingChats" | "customScenarios">): string {
  const dueCount = bundle.vocabulary.filter((item) => item.next_review <= new Date().toISOString().split("T")[0]).length;
  const recentSessions = bundle.sessions.slice(0, 3).map((session) => ({
    date: session.date,
    title: session.scenario.title,
    title_ja: session.scenario.title_ja,
  }));
  const activeChats = bundle.ongoingChats.slice(0, 3).map((chat) => ({
    name: chat.name,
    persona: chat.persona,
    lastActiveAt: chat.lastActiveAt,
  }));
  const customScenarios = bundle.customScenarios.slice(0, 5).map((scenario) => ({
    title: scenario.title,
    title_ja: scenario.title_ja,
  }));

  return JSON.stringify(
    {
      profile: {
        jlptLevel: bundle.profile.jlpt_level,
        estimatedLevel: bundle.profile.estimated_level,
        responseLength: bundle.profile.response_length,
        name: bundle.profile.name ?? null,
        aboutYou: bundle.profile.aboutYou ?? null,
        interests: bundle.profile.interests,
        recentStruggles: bundle.profile.recent_struggles,
        topicsCovered: bundle.profile.topics_covered,
        totalSessions: bundle.profile.total_sessions,
      },
      stats: {
        sessionCount: bundle.sessions.length,
        vocabularyCount: bundle.vocabulary.length,
        dueVocabularyCount: dueCount,
        ongoingChatCount: bundle.ongoingChats.length,
        customScenarioCount: bundle.customScenarios.length,
      },
      recentSessions,
      activeChats,
      customScenarios,
    },
    null,
    2
  );
}

function buildSenseiPrompt(context: SenseiRequestContext, thread: SenseiThread, accountSummary: string): string {
  const preferredLanguage = detectPreferredSenseiLanguage(thread.messages, context.locale);
  const fallbackLanguage = getLocaleFallbackLanguage(context.locale);
  const summaryBlock = thread.summary
    ? `\n\nSENSEI MEMORY SUMMARY:\n${thread.summary}`
    : "";

  return `You are Tama acting as Sensei, a persistent Japanese teacher inside a desktop learning app.

Your job:
- answer questions about the student's current view and their study history
- explain Japanese clearly, concretely, and briefly
- help the student connect current work to prior sessions, flashcards, and patterns
- stay grounded in the provided app context instead of inventing UI state

Rules:
1. Reply in the same language as the student's latest message unless the student clearly asks you to switch languages.
2. For the current turn, the best detected reply language is ${preferredLanguage}. If the latest message is ambiguous, fall back to ${fallbackLanguage}.
3. If the student mixes languages, answer in the language used for the actual question or request. Do not switch languages just because they mention a Japanese word or quote an example.
4. Be concise and practical. Prefer short explanations with examples over long lectures.
5. You may reference the student's saved learning history and the current app view.
6. Do not claim to have performed actions or changed data in the app unless a tool result confirms it.
7. You can create app content only by using the provided tools. Never pretend you created something unless the tool result confirms it.
8. Create scenarios, personas, or flashcards only when the student clearly asks you to save or create them.
9. If required details are missing, ask a short follow-up question before using a tool.
10. If the current view context is limited, say that plainly and answer from the account summary plus the student's question.
11. When useful, include Japanese examples and short breakdowns, but keep the surrounding explanation in the student's chosen language unless they ask otherwise.

TOOLS:
- create_custom_scenario: save a new custom practice scenario
- create_ongoing_chat_persona: save a new persistent chat persona
- create_flashcard: save a flashcard in the student's SRS deck

After a successful tool call, briefly tell the student what you created. If the tool reports an existing matching item, tell the student instead of claiming a new one was created.
${summaryBlock}

CURRENT DATE/TIME:
${getCurrentDateTimeBlock(context.locale)}

ACCOUNT SUMMARY:
${accountSummary}

CURRENT VIEW CONTEXT:
${formatViewContext(context.view)}`;
}

async function ensureSenseiThread(): Promise<SenseiThread> {
  const existingThreads = await getSenseiThreads();
  const activeId = getActiveSenseiThreadId();

  if (activeId) {
    const active = existingThreads.find((thread) => thread.id === activeId);
    if (active) return active;
  }

  if (existingThreads.length > 0) {
    const latest = existingThreads[0];
    setActiveSenseiThreadId(latest.id);
    return latest;
  }

  return createSenseiThread();
}

export function getActiveSenseiThreadId(): string | null {
  return localStorage.getItem(SENSEI_ACTIVE_THREAD_KEY);
}

export function setActiveSenseiThreadId(id: string | null): void {
  if (id) {
    localStorage.setItem(SENSEI_ACTIVE_THREAD_KEY, id);
  } else {
    localStorage.removeItem(SENSEI_ACTIVE_THREAD_KEY);
  }
}

export async function createSenseiThread(): Promise<SenseiThread> {
  const now = new Date().toISOString();
  const created: SenseiThread = {
    id: uuidv4(),
    messages: [],
    summary: "",
    createdAt: now,
    lastActiveAt: now,
    totalMessages: 0,
  };
  await saveSenseiThread(created);
  setActiveSenseiThreadId(created.id);
  return created;
}

async function maybeCompactSenseiThread(thread: SenseiThread, locale: AppLocale): Promise<SenseiThread> {
  if (thread.messages.length <= SENSEI_SUMMARIZE_THRESHOLD) {
    return thread;
  }

  const messagesToSummarize = thread.messages.slice(0, thread.messages.length - SENSEI_KEEP_AFTER_SUMMARIZE);
  const keptMessages = thread.messages.slice(-SENSEI_KEEP_AFTER_SUMMARIZE);
  const summary = await summarizeSenseiConversation(
    thread.summary,
    messagesToSummarize.map(formatSenseiMessageForModel),
    locale
  );
  const compacted: SenseiThread = {
    ...thread,
    messages: keptMessages,
    summary,
    lastActiveAt: new Date().toISOString(),
  };
  await saveSenseiThread(compacted);
  return compacted;
}

export async function loadSenseiThread(): Promise<SenseiThread> {
  return ensureSenseiThread();
}

export async function listSenseiThreads(): Promise<SenseiThread[]> {
  return getSenseiThreads();
}

export async function selectSenseiThread(threadId: string): Promise<SenseiThread> {
  const thread = await getSenseiThread(threadId);
  if (!thread) {
    throw new Error("Sensei chat not found.");
  }
  setActiveSenseiThreadId(thread.id);
  return thread;
}

export async function removeSenseiThread(threadId: string): Promise<SenseiThread> {
  const deleted = await deleteSenseiThread(threadId);
  if (!deleted) {
    throw new Error("Sensei chat not found.");
  }

  const remainingThreads = await getSenseiThreads();
  const activeId = getActiveSenseiThreadId();
  if (activeId === threadId) {
    if (remainingThreads.length > 0) {
      setActiveSenseiThreadId(remainingThreads[0].id);
      return remainingThreads[0];
    }

    return createSenseiThread();
  }

  if (remainingThreads.length === 0) {
    return createSenseiThread();
  }

  return remainingThreads[0];
}

export async function sendSenseiUserMessage(
  text: string,
  view: SenseiViewContext,
  options?: { onUserMessageSaved?: (thread: SenseiThread) => void }
): Promise<SenseiThread> {
  const trimmed = text.trim();
  if (!trimmed) {
    return ensureSenseiThread();
  }

  const locale = getAppLocale();
  let thread = await ensureSenseiThread();
  thread = await maybeCompactSenseiThread(thread, locale);

  const userMessage: Message = {
    id: uuidv4(),
    role: "user",
    content: trimmed,
    timestamp: new Date().toISOString(),
  };

  const nextMessages = [...thread.messages, userMessage];
  const pendingThread: SenseiThread = {
    ...thread,
    messages: nextMessages,
    lastActiveAt: userMessage.timestamp,
    totalMessages: thread.totalMessages + 1,
  };

  await saveSenseiThread(pendingThread);
  setActiveSenseiThreadId(pendingThread.id);
  options?.onUserMessageSaved?.(pendingThread);

  const [profile, sessions, vocabulary, ongoingChats, customScenarios] = await Promise.all([
    getUserProfile(),
    getSessions(),
    getVocabulary(),
    getOngoingChats(),
    getCustomScenarios(),
  ]);

  const systemPrompt = buildSenseiPrompt(
    { locale, view },
    pendingThread,
    buildAccountSummary({ profile, sessions, vocabulary, ongoingChats, customScenarios })
  );

  const response = await sendMessageWithTools(
    getContextMessages(nextMessages.map(formatSenseiMessageForModel)),
    systemPrompt,
    { tools: SENSEI_TOOLS, trackVocabularyUsage: false }
  );
  const assistantMessage: Message = {
    id: uuidv4(),
    role: "assistant",
    content: response,
    timestamp: new Date().toISOString(),
  };

  const updatedThread: SenseiThread = {
    ...pendingThread,
    messages: [...nextMessages, assistantMessage],
    lastActiveAt: new Date().toISOString(),
    totalMessages: pendingThread.totalMessages + 1,
  };

  await saveSenseiThread(updatedThread);
  setActiveSenseiThreadId(updatedThread.id);
  return updatedThread;
}
