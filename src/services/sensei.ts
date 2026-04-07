import { v4 as uuidv4 } from "uuid";
import { getAppLocale } from "@/services/app-config";
import { emitDataChanged } from "@/services/app-events";
import { getContextMessages, sendMessage, sendMessageWithTools, summarizeSenseiConversation } from "@/services/claude";
import { getActiveStudyPlan } from "@/services/study-plan";
import { SENSEI_TOOLS } from "@/services/tools";
import {
  deleteSenseiThread,
  getCustomScenarios,
  getOngoingChats,
  getQuizzes,
  getSenseiThread,
  getSenseiThreads,
  getSessions,
  getUserProfile,
  getVocabulary,
  saveQuiz,
  saveSenseiThread,
} from "@/services/storage";
import type {
  AccountBundleV1,
  AppLocale,
  Message,
  Quiz,
  QuizQuestion,
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
const SENSEI_TOOL_REQUEST_REGEX =
  /\b(create|save|add|make|generate|setup|set up|mark|complete|completed|finish|finished|done|check off|uncheck|undo|crear|guardar|agregar|añadir|hacer|generar|marcar|completar|completado|termin[eé]|terminado|hecho)\b/iu;
const SENSEI_SCENARIO_TARGET_REGEX = /\b(custom scenario|scenario|escenario)\b/iu;
const SENSEI_PERSONA_TARGET_REGEX =
  /\b(persona|friend|chat buddy|ongoing chat|persistent chat|companion|personaje)\b/iu;
const SENSEI_FLASHCARD_TARGET_REGEX =
  /\b(flashcard|flashcards|srs|spaced repetition|vocab card|vocabulary card|tarjeta de vocabulario|tarjetas de vocabulario)\b/iu;
const SENSEI_STUDY_PLAN_TARGET_REGEX =
  /\b(study plan|today'?s plan|plan item|plan task|task|step|daily plan|plan de hoy|plan diario|tarea|paso)\b/iu;
const SENSEI_QUIZ_REQUEST_REGEX =
  /\b(quiz|practice drill|drill|multiple choice|multiple-choice|fill in the blank|fill-in-the-blank|dropdown|test me|quiz me|cuestionario)\b/iu;
const SENSEI_TOOL_FOLLOW_UP_REGEX =
  /\b(again|retry|try again|please try again|go ahead|do it|please do|yes|yeah|yep|sure|ok|okay|otra vez|intenta de nuevo|hazlo|si|sí|dale|otro|otra|another one|one more|also|too)\b/iu;

function getQuizActionLabel(locale: AppLocale): string {
  return locale === "es" ? "Abrir quiz" : "Open quiz";
}

function getQuizReadyMessage(locale: AppLocale): string {
  return locale === "es"
    ? "Preparé un quiz para ti. Ábrelo cuando quieras."
    : "I put together a quiz for you. Open it when you're ready.";
}

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
  if (message.role === "assistant" && message.action?.type === "open_quiz") {
    const quizLinkSummary = `[Assistant linked quiz: ${message.action.title ?? message.action.label}]`;
    return {
      ...message,
      content: message.content ? `${message.content}\n\n${quizLinkSummary}` : quizLinkSummary,
    };
  }

  if (message.role === "user") {
    return {
      ...message,
      content: `[User message timestamp: ${message.timestamp}]\n${message.content}`,
    };
  }

  return message;
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

function buildAccountSummary(bundle: Pick<AccountBundleV1, "profile" | "sessions" | "vocabulary" | "ongoingChats" | "customScenarios" | "quizzes"> & {
  activeStudyPlan?: Awaited<ReturnType<typeof getActiveStudyPlan>>;
}): string {
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
  const recentQuizzes = (bundle.quizzes ?? []).slice(0, 5).map((quiz) => ({
    title: quiz.title,
    sourcePrompt: quiz.sourcePrompt,
    questionCount: quiz.questions.length,
    latestAttempt: quiz.latestAttempt
      ? {
          correctCount: quiz.latestAttempt.correctCount,
          totalCount: quiz.latestAttempt.totalCount,
          completedAt: quiz.latestAttempt.completedAt,
        }
      : null,
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
      recentQuizzes,
      activeStudyPlan: bundle.activeStudyPlan
        ? {
            date: bundle.activeStudyPlan.date,
            focusSummary: bundle.activeStudyPlan.focusSummary,
            reasoningSummary: bundle.activeStudyPlan.reasoningSummary,
            tasks: bundle.activeStudyPlan.tasks.map((task) => ({
              id: task.id,
              kind: task.kind,
              title: task.title,
              description: task.description,
              completed: Boolean(task.completedAt),
              completedAt: task.completedAt ?? null,
            })),
          }
        : null,
    },
    null,
    2
  );
}

function buildSenseiPrompt(
  context: SenseiRequestContext,
  thread: SenseiThread,
  accountSummary: string,
  toolsEnabled: boolean
): string {
  const preferredLanguage = detectPreferredSenseiLanguage(thread.messages, context.locale);
  const fallbackLanguage = getLocaleFallbackLanguage(context.locale);
  const summaryBlock = thread.summary
    ? `\n\nSENSEI MEMORY SUMMARY:\n${thread.summary}`
    : "";

  return `You are Tama acting as Sensei, a persistent Japanese teacher inside a desktop learning app.

Your job:
- answer questions about the student's current view and their study history
- explain the student's active daily study plan when one is available
- explain Japanese clearly, concretely, and briefly
- help the student connect current work to prior sessions, flashcards, and patterns
- when a study plan is present, help the student understand why those tasks were chosen and how to do them
- stay grounded in the provided app context instead of inventing UI state

Rules:
1. Reply in the same language as the student's latest message unless the student clearly asks you to switch languages.
2. For the current turn, the best detected reply language is ${preferredLanguage}. If the latest message is ambiguous, fall back to ${fallbackLanguage}.
3. If the student mixes languages, answer in the language used for the actual question or request. Do not switch languages just because they mention a Japanese word or quote an example.
4. Be concise and practical. Prefer short explanations with examples over long lectures.
5. You may reference the student's saved learning history and the current app view.
6. Do not claim to have performed actions or changed data in the app unless a tool result confirms it.
7. If tools are available for this turn, you can create app content only by using the provided tools. Never pretend you created something unless the tool result confirms it.
8. Create scenarios, personas, flashcards, or update study plan task status only when the student clearly asks, and only when tools are enabled for this turn.
9. If required details are missing, ask a short follow-up question before using a tool.
10. If the current view context is limited, say that plainly and answer from the account summary plus the student's question.
11. When useful, include Japanese examples and short breakdowns, but keep the surrounding explanation in the student's chosen language unless they ask otherwise.
12. If the student asks for a quiz, practice exercise, or drill, answer naturally and assume the app may create a separate quiz experience for them. Do not embed a full quiz payload in your reply.
13. Gratitude, acknowledgements, reactions, or short follow-ups like "thanks", "good stuff", or "I get it" should always get a short normal reply.

${toolsEnabled
    ? `TOOLS:
- create_custom_scenario: save a new custom practice scenario
- create_ongoing_chat_persona: save a new persistent chat persona
- create_flashcard: save a flashcard in the student's SRS deck
- update_study_plan_task_status: mark a task in today's study plan as done or not done

After a successful tool call, briefly tell the student what you created. If the tool reports an existing matching item, tell the student instead of claiming a new one was created.`
    : `No creation tools are enabled for this turn. Answer in chat only and do not claim to save or create app content.`}
${summaryBlock}

CURRENT DATE/TIME:
${getCurrentDateTimeBlock(context.locale)}

ACCOUNT SUMMARY:
${accountSummary}

CURRENT VIEW CONTEXT:
${formatViewContext(context.view)}`;
}

function senseiViewImpliesToolTarget(view: SenseiViewContext): {
  scenario: boolean;
  persona: boolean;
  flashcard: boolean;
  studyPlan: boolean;
} {
  switch (view.screen) {
    case "scenario-select":
    case "conversation":
      return { scenario: true, persona: false, flashcard: false, studyPlan: false };
    case "ongoing-chat":
    case "ongoing-chats":
      return { scenario: false, persona: true, flashcard: false, studyPlan: false };
    case "flashcards":
      return { scenario: false, persona: false, flashcard: true, studyPlan: false };
    case "home":
      return { scenario: false, persona: false, flashcard: false, studyPlan: true };
    default:
      return { scenario: false, persona: false, flashcard: false, studyPlan: false };
  }
}

function shouldEnableSenseiTools(
  text: string,
  view: SenseiViewContext,
  recentMessages: Message[]
): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }

  const recentUserText = recentMessages
    .filter((message) => message.role === "user")
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join("\n");
  const currentHasActionVerb = SENSEI_TOOL_REQUEST_REGEX.test(trimmed);
  const recentHasActionVerb = SENSEI_TOOL_REQUEST_REGEX.test(recentUserText);
  const currentIsFollowUp = SENSEI_TOOL_FOLLOW_UP_REGEX.test(trimmed);

  if (!currentHasActionVerb && !(currentIsFollowUp && recentHasActionVerb)) {
    return false;
  }

  const targetText = `${recentUserText}\n${trimmed}`;
  const impliedTargets = senseiViewImpliesToolTarget(view);

  return (
    SENSEI_SCENARIO_TARGET_REGEX.test(targetText) ||
    SENSEI_PERSONA_TARGET_REGEX.test(targetText) ||
    SENSEI_FLASHCARD_TARGET_REGEX.test(targetText) ||
    SENSEI_STUDY_PLAN_TARGET_REGEX.test(targetText) ||
    (impliedTargets.scenario && currentHasActionVerb) ||
    (impliedTargets.persona && currentHasActionVerb) ||
    (impliedTargets.flashcard && currentHasActionVerb) ||
    (impliedTargets.studyPlan && currentHasActionVerb)
  );
}

function shouldCreateSenseiQuiz(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }

  return SENSEI_QUIZ_REQUEST_REGEX.test(trimmed);
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return trimmed;
}

function parseLooseJsonObject(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    try {
      return JSON.parse(text.replace(/,\s*([}\]])/g, "$1")) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function parseQuizQuestion(value: unknown, index: number): QuizQuestion | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const question = value as Record<string, unknown>;
  const rawOptionsSource = Array.isArray(question.options)
    ? question.options
    : Array.isArray(question.choices)
      ? question.choices
      : undefined;
  const options = rawOptionsSource
    ?.filter((option): option is string => typeof option === "string" && option.trim().length > 0)
    .map((option) => option.trim());
  const rawOptionReadingsSource = Array.isArray(question.optionReadings)
    ? question.optionReadings
    : Array.isArray(question.option_readings)
      ? question.option_readings
      : undefined;
  const optionReadings = rawOptionReadingsSource
    ?.map((option) => typeof option === "string" ? option.trim() : "");
  const rawType = typeof question.type === "string" ? question.type.trim().toLowerCase() : "";
  const type =
    rawType === "multiple_choice" ||
    rawType === "multiple-choice" ||
    rawType === "multiple choice" ||
    rawType === "mcq"
      ? "multiple_choice"
      : rawType === "fill_blank" || rawType === "fill-blank" || rawType === "fill blank"
        ? "fill_blank"
        : rawType === "dropdown" || rawType === "select"
          ? "dropdown"
          : options && options.length > 0
            ? "multiple_choice"
            : "fill_blank";

  const id = typeof question.id === "string" ? question.id.trim() : `q${index + 1}`;
  const prompt =
    typeof question.prompt === "string"
      ? question.prompt.trim()
      : typeof question.question === "string"
        ? question.question.trim()
        : "";
  const promptReading =
    typeof question.promptReading === "string"
      ? question.promptReading.trim()
      : typeof question.prompt_reading === "string"
        ? question.prompt_reading.trim()
        : "";
  const correctAnswer =
    typeof question.correctAnswer === "string"
      ? question.correctAnswer.trim()
      : typeof question.correct_answer === "string"
        ? question.correct_answer.trim()
        : "";
  const correctAnswerReading =
    typeof question.correctAnswerReading === "string"
      ? question.correctAnswerReading.trim()
      : typeof question.correct_answer_reading === "string"
        ? question.correct_answer_reading.trim()
        : "";
  const explanation =
    typeof question.explanation === "string"
      ? question.explanation.trim()
      : typeof question.reasoning === "string"
        ? question.reasoning.trim()
        : "Review the correction and compare it with the target phrasing.";
  const explanationReading =
    typeof question.explanationReading === "string"
      ? question.explanationReading.trim()
      : typeof question.explanation_reading === "string"
        ? question.explanation_reading.trim()
        : "";

  if (!prompt || !correctAnswer) {
    return null;
  }

  if ((type === "multiple_choice" || type === "dropdown") && (!options || options.length < 2)) {
    return null;
  }

  return {
    id,
    prompt,
    promptReading: promptReading || undefined,
    type,
    options,
    optionReadings:
      optionReadings && (!options || optionReadings.length === options.length)
        ? optionReadings
        : undefined,
    correctAnswer,
    correctAnswerReading: correctAnswerReading || undefined,
    explanation,
    explanationReading: explanationReading || undefined,
  };
}

function parseGeneratedSenseiQuiz(raw: string): {
  introMessage: string;
  title: string;
  titleReading?: string;
  instructions: string;
  instructionsReading?: string;
  questions: QuizQuestion[];
} | null {
  const extracted = extractJsonObject(raw);
  const parsed = parseLooseJsonObject(extracted);
  if (!parsed) {
    return null;
  }

  const quizRecord =
    parsed.quiz && typeof parsed.quiz === "object"
      ? (parsed.quiz as Record<string, unknown>)
      : parsed;
  const title =
    typeof quizRecord.title === "string"
      ? quizRecord.title.trim()
      : typeof quizRecord.name === "string"
        ? quizRecord.name.trim()
        : "";
  const titleReading =
    typeof quizRecord.titleReading === "string"
      ? quizRecord.titleReading.trim()
      : typeof quizRecord.title_reading === "string"
        ? quizRecord.title_reading.trim()
        : "";
  const instructions =
    typeof quizRecord.instructions === "string"
      ? quizRecord.instructions.trim()
      : typeof quizRecord.description === "string"
        ? quizRecord.description.trim()
        : "Choose the best answer for each question.";
  const instructionsReading =
    typeof quizRecord.instructionsReading === "string"
      ? quizRecord.instructionsReading.trim()
      : typeof quizRecord.instructions_reading === "string"
        ? quizRecord.instructions_reading.trim()
        : "";
  const introMessage =
    typeof parsed.reply === "string"
      ? parsed.reply.trim()
      : typeof parsed.introMessage === "string"
        ? parsed.introMessage.trim()
        : "";
  const rawQuestions = Array.isArray(quizRecord.questions)
    ? quizRecord.questions
    : Array.isArray(quizRecord.items)
      ? quizRecord.items
      : null;

  if (!title || !rawQuestions || rawQuestions.length === 0) {
    return null;
  }

  const questions = rawQuestions
    .map((question, index) => parseQuizQuestion(question, index))
    .filter((question): question is QuizQuestion => Boolean(question))
    .slice(0, 5);

  if (questions.length === 0) {
    return null;
  }

  return {
    introMessage,
    title,
    titleReading: titleReading || undefined,
    instructions,
    instructionsReading: instructionsReading || undefined,
    questions,
  };
}

function buildSenseiQuizPrompt(context: SenseiRequestContext, thread: SenseiThread, accountSummary: string): string {
  const preferredLanguage = detectPreferredSenseiLanguage(thread.messages, context.locale);
  const fallbackLanguage = getLocaleFallbackLanguage(context.locale);
  const summaryBlock = thread.summary
    ? `\n\nSENSEI MEMORY SUMMARY:\n${thread.summary}`
    : "";

  return `You are Tama generating a standalone Japanese learning quiz for a desktop app.

Return ONLY valid JSON with no markdown fences and no extra commentary.

Output schema:
{
  "reply": "short intro text shown in chat above the quiz link",
  "quiz": {
    "title": "short quiz title",
    "titleReading": "hiragana reading for any Japanese in the title",
    "instructions": "brief instructions",
    "instructionsReading": "hiragana reading for any Japanese in the instructions",
    "questions": [
      {
        "id": "q1",
        "type": "multiple_choice" | "fill_blank" | "dropdown",
        "prompt": "question text",
        "promptReading": "hiragana reading for any Japanese in the prompt",
        "options": ["choice A", "choice B"],
        "optionReadings": ["hiragana reading for option A", "hiragana reading for option B"],
        "correctAnswer": "exact correct answer string",
        "correctAnswerReading": "hiragana reading for any Japanese in the correct answer",
        "explanation": "brief explanation",
        "explanationReading": "hiragana reading for any Japanese in the explanation"
      }
    ]
  }
}

Rules:
- The student's current preferred response language is ${preferredLanguage}. If ambiguous, fall back to ${fallbackLanguage}.
- Create 2 to 5 questions only.
- Focus tightly on the student's request and recent struggles.
- Prefer multiple_choice when possible because it is the easiest format to render and complete.
- Only include "options" for multiple_choice and dropdown questions.
- Include the titleReading, instructionsReading, promptReading, optionReadings, correctAnswerReading, and explanationReading fields whenever the paired text contains Japanese.
- Every reading field must be written only in hiragana.
- For mixed English/Japanese strings, each reading should cover only the Japanese wording in the same order it appears.
- Do not include romaji unless the student explicitly requested it.
- Keep the quiz practical and teach toward one clear pattern or mistake.
- Keep the chat "reply" short, natural, and inviting.
${summaryBlock}

CURRENT DATE/TIME:
${getCurrentDateTimeBlock(context.locale)}

ACCOUNT SUMMARY:
${accountSummary}

CURRENT VIEW CONTEXT:
${formatViewContext(context.view)}`;
}

async function generateSenseiQuiz(
  request: string,
  context: SenseiRequestContext,
  thread: SenseiThread,
  accountSummary: string
): Promise<Quiz> {
  const systemPrompt = buildSenseiQuizPrompt(context, thread, accountSummary);
  const userMessage = `Create a standalone quiz for this request:\n${request}`;
  const rawResponse = await sendMessage(
    [{ id: "sensei-quiz-request", role: "user", content: userMessage, timestamp: new Date().toISOString() }],
    systemPrompt
  );
  const parsed = parseGeneratedSenseiQuiz(rawResponse);

  if (!parsed) {
    throw new Error("Failed to generate a valid quiz.");
  }

  const now = new Date().toISOString();
  const quiz: Quiz = {
    id: crypto.randomUUID(),
    title: parsed.title,
    titleReading: parsed.titleReading,
    instructions: parsed.instructions,
    instructionsReading: parsed.instructionsReading,
    createdAt: now,
    updatedAt: now,
    source: "sensei",
    sourcePrompt: request,
    introMessage: parsed.introMessage,
    questions: parsed.questions,
  };

  await saveQuiz(quiz);
  emitDataChanged("quiz-write");
  return quiz;
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

  const [profile, sessions, vocabulary, ongoingChats, customScenarios, quizzes, activeStudyPlan] = await Promise.all([
    getUserProfile(),
    getSessions(),
    getVocabulary(),
    getOngoingChats(),
    getCustomScenarios(),
    getQuizzes(),
    getActiveStudyPlan(),
  ]);
  const toolsEnabled = shouldEnableSenseiTools(trimmed, view, pendingThread.messages.slice(-6));
  const quizRequested = shouldCreateSenseiQuiz(trimmed);
  const accountSummary = buildAccountSummary({
    profile,
    sessions,
    vocabulary,
    ongoingChats,
    customScenarios,
    quizzes,
    activeStudyPlan,
  });

  if (quizRequested) {
    const quiz = await generateSenseiQuiz(trimmed, { locale, view }, pendingThread, accountSummary);
    const assistantMessage: Message = {
      id: uuidv4(),
      role: "assistant",
      content: quiz.introMessage?.trim() || getQuizReadyMessage(locale),
      timestamp: new Date().toISOString(),
      action: {
        type: "open_quiz",
        quizId: quiz.id,
        label: getQuizActionLabel(locale),
        title: quiz.title,
      },
    };

    const updatedThread: SenseiThread = {
      ...pendingThread,
      messages: [...nextMessages, assistantMessage],
      lastActiveAt: assistantMessage.timestamp,
      totalMessages: pendingThread.totalMessages + 1,
    };

    await saveSenseiThread(updatedThread);
    setActiveSenseiThreadId(updatedThread.id);
    return updatedThread;
  }

  const systemPrompt = buildSenseiPrompt(
    { locale, view },
    pendingThread,
    accountSummary,
    toolsEnabled
  );

  const modelMessages = getContextMessages(nextMessages.map(formatSenseiMessageForModel));
  const response = toolsEnabled
    ? await sendMessageWithTools(modelMessages, systemPrompt, {
        tools: SENSEI_TOOLS,
        trackVocabularyUsage: false,
      })
    : await sendMessage(modelMessages, systemPrompt);
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
