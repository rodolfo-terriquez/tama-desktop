import { getVersion } from "@tauri-apps/api/app";
import {
  getAppLocale,
  isApiOnboardingDismissed,
  setApiOnboardingDismissed,
  setAppLocale,
} from "@/services/app-config";
import {
  getLLMProvider,
  getOpenRouterModel,
  setLLMProvider,
  setOpenRouterModel,
  getLocalBaseUrl,
  setLocalBaseUrl,
  getLocalModel,
  setLocalModel,
} from "@/services/claude";
import { getDisplayMode, setDisplayMode } from "@/services/display";
import { emitConfigChanged, emitDataChanged } from "@/services/app-events";
import {
  getCustomScenarios,
  getFlashcardReviewSessions,
  getOngoingChats,
  getQuizzes,
  getSenseiThreads,
  getSessions,
  getShadowScripts,
  getStudyPlans,
  getUserProfile,
  getVocabulary,
  replaceAccountBundle,
} from "@/services/storage";
import {
  clearStoredVoiceId,
  getSBV2BaseUrl,
  getStoredEngineType,
  getStoredSpeechRate,
  getStoredVoiceId,
  setSBV2BaseUrl,
  setStoredEngineType,
  setStoredSpeechRate,
  setStoredVoiceId,
} from "@/services/tts";
import { getTranscriptionEngine, setTranscriptionEngine } from "@/services/transcription";
import type {
  AccountBundleV1,
  AccountPreferences,
  FlashcardReviewSession,
  Message,
  OngoingChat,
  Quiz,
  Scenario,
  SenseiThread,
  Session,
  ShadowScript,
  StudyPlan,
  UserProfile,
  VocabItem,
} from "@/types";
import { getActiveSenseiThreadId, setActiveSenseiThreadId } from "@/services/sensei";

export const ACCOUNT_BUNDLE_SCHEMA_VERSION = 1;

function downloadTextFile(filename: string, text: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function isMessage(value: unknown): value is Message {
  if (!isRecord(value)) return false;
  return (
    isString(value.id) &&
    (value.role === "user" || value.role === "assistant") &&
    isString(value.content) &&
    isString(value.timestamp) &&
    (value.action === undefined ||
      (isRecord(value.action) &&
        value.action.type === "open_quiz" &&
        isString(value.action.quizId) &&
        isString(value.action.label) &&
        (value.action.title === undefined || isString(value.action.title))))
  );
}

function isQuiz(value: unknown): value is Quiz {
  if (!isRecord(value)) return false;
  return (
    isString(value.id) &&
    isString(value.title) &&
    (value.titleReading === undefined || isString(value.titleReading)) &&
    isString(value.instructions) &&
    (value.instructionsReading === undefined || isString(value.instructionsReading)) &&
    isString(value.createdAt) &&
    isString(value.updatedAt) &&
    value.source === "sensei" &&
    isString(value.sourcePrompt) &&
    (value.introMessage === undefined || isString(value.introMessage)) &&
    Array.isArray(value.questions) &&
    value.questions.every((question) => {
      if (!isRecord(question)) return false;
      return (
        isString(question.id) &&
        isString(question.prompt) &&
        (question.promptReading === undefined || isString(question.promptReading)) &&
        (question.type === "multiple_choice" ||
          question.type === "fill_blank" ||
          question.type === "dropdown") &&
        (question.options === undefined || isStringArray(question.options)) &&
        (question.optionReadings === undefined || isStringArray(question.optionReadings)) &&
        isString(question.correctAnswer) &&
        (question.correctAnswerReading === undefined || isString(question.correctAnswerReading)) &&
        isString(question.explanation) &&
        (question.explanationReading === undefined || isString(question.explanationReading))
      );
    })
  );
}

function isScenario(value: unknown): value is Scenario {
  if (!isRecord(value)) return false;
  return (
    isString(value.id) &&
    isString(value.title) &&
    isString(value.title_ja) &&
    isString(value.description) &&
    isString(value.setting) &&
    isString(value.character_role) &&
    isStringArray(value.objectives) &&
    (value.custom_prompt === undefined || isString(value.custom_prompt))
  );
}

function isVocabItem(value: unknown): value is VocabItem {
  if (!isRecord(value)) return false;
  return (
    isString(value.id) &&
    isString(value.word) &&
    isString(value.reading) &&
    isString(value.meaning) &&
    isString(value.example) &&
    isString(value.source_session) &&
    isNumber(value.interval) &&
    isNumber(value.ease_factor) &&
    isString(value.next_review) &&
    isNumber(value.times_seen_in_conversation) &&
    isNumber(value.times_reviewed)
  );
}

function isSession(value: unknown): value is Session {
  if (!isRecord(value)) return false;
  return (
    isString(value.id) &&
    isString(value.date) &&
    isScenario(value.scenario) &&
    Array.isArray(value.messages) &&
    value.messages.every(isMessage) &&
    isNumber(value.duration_seconds) &&
    (value.feedback === null || value.feedback === undefined || isRecord(value.feedback)) &&
    (value.run_mode === undefined ||
      value.run_mode === "conversation" ||
      value.run_mode === "shadow")
  );
}

function isFlashcardReviewSession(value: unknown): value is FlashcardReviewSession {
  if (!isRecord(value)) return false;
  return (
    isString(value.id) &&
    isString(value.date) &&
    isNumber(value.duration_seconds) &&
    Array.isArray(value.results) &&
    value.results.every((result) =>
      isRecord(result) &&
      isString(result.word) &&
      (result.rating === "again" ||
        result.rating === "hard" ||
        result.rating === "good" ||
        result.rating === "easy")
    )
  );
}

function isShadowScript(value: unknown): value is ShadowScript {
  if (!isRecord(value)) return false;
  return (
    isString(value.id) &&
    isString(value.scenarioId) &&
    isString(value.generatedAt) &&
    Array.isArray(value.turns) &&
    value.turns.every((turn) =>
      isRecord(turn) &&
      (turn.speaker === "assistant" || turn.speaker === "user") &&
      isString(turn.text) &&
      (turn.reading === undefined || isString(turn.reading)) &&
      (turn.speakerLabel === undefined || isString(turn.speakerLabel)) &&
      (turn.cue === undefined || isString(turn.cue))
    ) &&
    isStringArray(value.focusPhrases)
  );
}

function isStudyPlan(value: unknown): value is StudyPlan {
  if (!isRecord(value)) return false;
  return (
    isString(value.id) &&
    isString(value.date) &&
    isString(value.generatedAt) &&
    isString(value.focusSummary) &&
    isString(value.reasoningSummary) &&
    Array.isArray(value.tasks) &&
    value.tasks.every((task) => {
      if (!isRecord(task) || !isRecord(task.target)) return false;
      const validTarget =
        task.target.screen === "flashcards" ||
        (task.target.screen === "scenario" && isString(task.target.scenarioId)) ||
        (task.target.screen === "sensei" &&
          (task.target.prompt === undefined || isString(task.target.prompt)));
      return (
        isString(task.id) &&
        (task.kind === "flashcards" || task.kind === "scenario" || task.kind === "sensei") &&
        isString(task.title) &&
        isString(task.description) &&
        isString(task.ctaLabel) &&
        validTarget &&
        (task.completedAt === undefined || isString(task.completedAt))
      );
    }) &&
    isRecord(value.sourceSignals)
  );
}

function isOngoingChat(value: unknown): value is OngoingChat {
  if (!isRecord(value)) return false;
  return (
    isString(value.id) &&
    isString(value.name) &&
    isString(value.persona) &&
    Array.isArray(value.messages) &&
    value.messages.every(isMessage) &&
    isString(value.summary) &&
    isString(value.createdAt) &&
    isString(value.lastActiveAt) &&
    isNumber(value.totalMessages) &&
    isNumber(value.lastFeedbackAtTotal)
  );
}

function isUserProfile(value: unknown): value is UserProfile {
  if (!isRecord(value)) return false;
  return (
    (value.jlpt_level === "N5" ||
      value.jlpt_level === "N4" ||
      value.jlpt_level === "N3" ||
      value.jlpt_level === "N2" ||
      value.jlpt_level === "N1") &&
    typeof value.auto_adjust_level === "boolean" &&
    (value.estimated_level === "beginner" ||
      value.estimated_level === "intermediate" ||
      value.estimated_level === "advanced") &&
    (value.response_length === "short" ||
      value.response_length === "natural" ||
      value.response_length === "long") &&
    typeof value.include_flashcard_vocab_in_conversations === "boolean" &&
    (value.name === undefined || isString(value.name)) &&
    (value.age === undefined || isNumber(value.age)) &&
    (value.aboutYou === undefined || isString(value.aboutYou)) &&
    isStringArray(value.interests) &&
    isStringArray(value.topics_covered) &&
    isStringArray(value.recent_struggles) &&
    isNumber(value.total_sessions) &&
    (value.voicevox_speaker_id === undefined || isNumber(value.voicevox_speaker_id)) &&
    (value.voicevox_speaker_name === undefined || isString(value.voicevox_speaker_name))
  );
}

function isSenseiThread(value: unknown): value is SenseiThread {
  if (!isRecord(value)) return false;
  return (
    isString(value.id) &&
    Array.isArray(value.messages) &&
    value.messages.every(isMessage) &&
    isString(value.summary) &&
    isString(value.createdAt) &&
    isString(value.lastActiveAt) &&
    isNumber(value.totalMessages)
  );
}

function isAccountPreferences(value: unknown): value is AccountPreferences {
  if (!isRecord(value)) return false;
  return (
    (value.appLocale === "en" || value.appLocale === "es") &&
    typeof value.apiOnboardingDismissed === "boolean" &&
    (value.llmProvider === "anthropic" ||
      value.llmProvider === "openrouter" ||
      value.llmProvider === "local") &&
    isString(value.openRouterModel) &&
    (value.localBaseUrl === undefined || isString(value.localBaseUrl)) &&
    (value.localModel === undefined || isString(value.localModel)) &&
    (value.displayMode === "light" || value.displayMode === "dark" || value.displayMode === "system") &&
    (value.ttsEngine === "voicevox" || value.ttsEngine === "sbv2") &&
    (value.ttsVoiceId === null || isString(value.ttsVoiceId)) &&
    (value.ttsSpeechRate === undefined || isNumber(value.ttsSpeechRate)) &&
    isString(value.sbv2BaseUrl) &&
    (value.transcriptionEngine === "local" || value.transcriptionEngine === "openai")
  );
}

export function validateAccountBundle(value: unknown): AccountBundleV1 {
  if (!isRecord(value)) {
    throw new Error("Backup file does not contain a valid account object.");
  }

  if (value.schemaVersion !== ACCOUNT_BUNDLE_SCHEMA_VERSION) {
    throw new Error("This backup file version is not supported by the current app.");
  }

  if (
    !isString(value.exportedAt) ||
    !isString(value.appVersion) ||
    !isUserProfile(value.profile) ||
    !Array.isArray(value.sessions) ||
    !value.sessions.every(isSession) ||
    !Array.isArray(value.vocabulary) ||
    !value.vocabulary.every(isVocabItem) ||
    !Array.isArray(value.ongoingChats) ||
    !value.ongoingChats.every(isOngoingChat) ||
    !Array.isArray(value.customScenarios) ||
    !value.customScenarios.every(isScenario) ||
    (value.quizzes !== undefined && (!Array.isArray(value.quizzes) || !value.quizzes.every(isQuiz))) ||
    !isAccountPreferences(value.preferences) ||
    (value.sensei !== undefined && !isSenseiThread(value.sensei)) ||
    (value.senseiThreads !== undefined &&
      (!Array.isArray(value.senseiThreads) || !value.senseiThreads.every(isSenseiThread))) ||
    (value.activeSenseiThreadId !== undefined &&
      value.activeSenseiThreadId !== null &&
      !isString(value.activeSenseiThreadId)) ||
    (value.flashcardReviewSessions !== undefined &&
      (!Array.isArray(value.flashcardReviewSessions) ||
        !value.flashcardReviewSessions.every(isFlashcardReviewSession))) ||
    (value.studyPlans !== undefined &&
      (!Array.isArray(value.studyPlans) || !value.studyPlans.every(isStudyPlan))) ||
    (value.shadowScripts !== undefined &&
      (!Array.isArray(value.shadowScripts) || !value.shadowScripts.every(isShadowScript)))
  ) {
    throw new Error("Backup file is missing required Tama account fields.");
  }

  return value as unknown as AccountBundleV1;
}

export function getAccountPreferences(): AccountPreferences {
  return {
    appLocale: getAppLocale(),
    apiOnboardingDismissed: isApiOnboardingDismissed(),
    llmProvider: getLLMProvider(),
    openRouterModel: getOpenRouterModel(),
    localBaseUrl: getLocalBaseUrl(),
    localModel: getLocalModel(),
    displayMode: getDisplayMode(),
    ttsEngine: getStoredEngineType(),
    ttsVoiceId: getStoredVoiceId(),
    ttsSpeechRate: getStoredSpeechRate(),
    sbv2BaseUrl: getSBV2BaseUrl(),
    transcriptionEngine: getTranscriptionEngine(),
  };
}

export function applyAccountPreferences(preferences: AccountPreferences): void {
  setAppLocale(preferences.appLocale);
  setApiOnboardingDismissed(preferences.apiOnboardingDismissed);
  setLLMProvider(preferences.llmProvider);
  setOpenRouterModel(preferences.openRouterModel);
  if (preferences.localBaseUrl) setLocalBaseUrl(preferences.localBaseUrl);
  if (preferences.localModel) setLocalModel(preferences.localModel);
  setDisplayMode(preferences.displayMode);
  setStoredEngineType(preferences.ttsEngine);
  if (preferences.ttsSpeechRate !== undefined) {
    setStoredSpeechRate(preferences.ttsSpeechRate);
  }

  if (preferences.ttsVoiceId) {
    setStoredVoiceId(preferences.ttsVoiceId);
  } else {
    clearStoredVoiceId();
  }

  setSBV2BaseUrl(preferences.sbv2BaseUrl);
  setTranscriptionEngine(preferences.transcriptionEngine);
}

export async function buildAccountBundle(): Promise<AccountBundleV1> {
  const [
    profile,
    sessions,
    vocabulary,
    ongoingChats,
    customScenarios,
    quizzes,
    senseiThreads,
    flashcardReviewSessions,
    studyPlans,
    shadowScripts,
  ] = await Promise.all([
    getUserProfile(),
    getSessions(),
    getVocabulary(),
    getOngoingChats(),
    getCustomScenarios(),
    getQuizzes(),
    getSenseiThreads(),
    getFlashcardReviewSessions(),
    getStudyPlans(),
    getShadowScripts(),
  ]);

  let appVersion = "unknown";
  try {
    appVersion = await getVersion();
  } catch {
    // keep fallback for environments where Tauri app metadata is unavailable
  }

  return {
    schemaVersion: ACCOUNT_BUNDLE_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion,
    profile,
    sessions,
    vocabulary,
    ongoingChats,
    customScenarios,
    ...(quizzes.length > 0 ? { quizzes } : {}),
    preferences: getAccountPreferences(),
    ...(senseiThreads.length > 0 ? { senseiThreads } : {}),
    activeSenseiThreadId: getActiveSenseiThreadId(),
    flashcardReviewSessions,
    studyPlans,
    shadowScripts,
  };
}

export async function exportAccountBackup(): Promise<void> {
  const bundle = await buildAccountBundle();
  const exportedAt = bundle.exportedAt.slice(0, 10);
  downloadTextFile(
    `tama-account-${exportedAt}.json`,
    JSON.stringify(bundle, null, 2)
  );
}

export async function restoreAccountBackupFromText(text: string): Promise<AccountBundleV1> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Backup file is not valid JSON.");
  }

  const bundle = validateAccountBundle(parsed);
  await replaceAccountBundle(bundle);
  setActiveSenseiThreadId(bundle.activeSenseiThreadId ?? bundle.sensei?.id ?? bundle.senseiThreads?.[0]?.id ?? null);
  applyAccountPreferences(bundle.preferences);
  emitConfigChanged();
  emitDataChanged("account-restore");
  return bundle;
}
