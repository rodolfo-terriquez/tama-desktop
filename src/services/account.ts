import { getVersion } from "@tauri-apps/api/app";
import {
  getAppLocale,
  isApiOnboardingDismissed,
  setApiOnboardingDismissed,
  setAppLocale,
} from "@/services/app-config";
import { getLLMProvider, getOpenRouterModel, setLLMProvider, setOpenRouterModel } from "@/services/claude";
import { getDisplayMode, setDisplayMode } from "@/services/display";
import { emitConfigChanged, emitDataChanged } from "@/services/app-events";
import {
  getCustomScenarios,
  getOngoingChats,
  getSenseiThreads,
  getSessions,
  getUserProfile,
  getVocabulary,
  replaceAccountBundle,
} from "@/services/storage";
import {
  clearStoredVoiceId,
  getSBV2BaseUrl,
  getStoredEngineType,
  getStoredVoiceId,
  setSBV2BaseUrl,
  setStoredEngineType,
  setStoredVoiceId,
} from "@/services/tts";
import { getTranscriptionEngine, setTranscriptionEngine } from "@/services/transcription";
import type {
  AccountBundleV1,
  AccountPreferences,
  Message,
  OngoingChat,
  Scenario,
  SenseiThread,
  Session,
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
    isString(value.timestamp)
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
    (value.llmProvider === "anthropic" || value.llmProvider === "openrouter") &&
    isString(value.openRouterModel) &&
    (value.displayMode === "light" || value.displayMode === "dark" || value.displayMode === "system") &&
    (value.ttsEngine === "voicevox" || value.ttsEngine === "sbv2") &&
    (value.ttsVoiceId === null || isString(value.ttsVoiceId)) &&
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
    !isAccountPreferences(value.preferences) ||
    (value.sensei !== undefined && !isSenseiThread(value.sensei)) ||
    (value.senseiThreads !== undefined &&
      (!Array.isArray(value.senseiThreads) || !value.senseiThreads.every(isSenseiThread))) ||
    (value.activeSenseiThreadId !== undefined &&
      value.activeSenseiThreadId !== null &&
      !isString(value.activeSenseiThreadId))
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
    displayMode: getDisplayMode(),
    ttsEngine: getStoredEngineType(),
    ttsVoiceId: getStoredVoiceId(),
    sbv2BaseUrl: getSBV2BaseUrl(),
    transcriptionEngine: getTranscriptionEngine(),
  };
}

export function applyAccountPreferences(preferences: AccountPreferences): void {
  setAppLocale(preferences.appLocale);
  setApiOnboardingDismissed(preferences.apiOnboardingDismissed);
  setLLMProvider(preferences.llmProvider);
  setOpenRouterModel(preferences.openRouterModel);
  setDisplayMode(preferences.displayMode);
  setStoredEngineType(preferences.ttsEngine);

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
    senseiThreads,
  ] = await Promise.all([
    getUserProfile(),
    getSessions(),
    getVocabulary(),
    getOngoingChats(),
    getCustomScenarios(),
    getSenseiThreads(),
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
    preferences: getAccountPreferences(),
    ...(senseiThreads.length > 0 ? { senseiThreads } : {}),
    activeSenseiThreadId: getActiveSenseiThreadId(),
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
