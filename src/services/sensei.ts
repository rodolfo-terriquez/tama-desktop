import { v4 as uuidv4 } from "uuid";
import { getAppLocale } from "@/services/app-config";
import { getContextMessages, sendMessage, summarizeSenseiConversation } from "@/services/claude";
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

function getTargetLanguage(locale: AppLocale): "English" | "Spanish" {
  return locale === "es" ? "Spanish" : "English";
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
    dateStyle: "full",
    timeStyle: "long",
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
  const targetLanguage = getTargetLanguage(context.locale);
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
1. Default to natural ${targetLanguage} unless the student clearly asks to switch.
2. Be concise and practical. Prefer short explanations with examples over long lectures.
3. You may reference the student's saved learning history and the current app view.
4. Do not claim to have performed actions or changed data in the app.
5. In v1, you are ask-only. You can suggest what the student could do next, but you cannot create or edit scenarios, personas, flashcards, or settings.
6. If the current view context is limited, say that plainly and answer from the account summary plus the student's question.
7. When useful, include Japanese examples and short breakdowns, but avoid unnecessary verbosity.
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

export async function sendSenseiUserMessage(text: string, view: SenseiViewContext): Promise<SenseiThread> {
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
  const [profile, sessions, vocabulary, ongoingChats, customScenarios] = await Promise.all([
    getUserProfile(),
    getSessions(),
    getVocabulary(),
    getOngoingChats(),
    getCustomScenarios(),
  ]);

  const systemPrompt = buildSenseiPrompt(
    { locale, view },
    thread,
    buildAccountSummary({ profile, sessions, vocabulary, ongoingChats, customScenarios })
  );

  const response = await sendMessage(
    getContextMessages(nextMessages.map(formatSenseiMessageForModel)),
    systemPrompt
  );
  const assistantMessage: Message = {
    id: uuidv4(),
    role: "assistant",
    content: response,
    timestamp: new Date().toISOString(),
  };

  const updatedThread: SenseiThread = {
    ...thread,
    messages: [...nextMessages, assistantMessage],
    lastActiveAt: new Date().toISOString(),
    totalMessages: thread.totalMessages + 2,
  };

  await saveSenseiThread(updatedThread);
  setActiveSenseiThreadId(updatedThread.id);
  return updatedThread;
}
