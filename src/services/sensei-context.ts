import { localizeScenario } from "@/data/scenarios";
import type {
  AppLocale,
  AppScreen,
  JLPTLevel,
  Message,
  Scenario,
  ShadowAttempt,
  ShadowScript,
  SenseiFlashcardResult,
  SenseiScenarioSummary,
  SenseiViewContext,
  VocabItem,
} from "@/types";

const MAX_CONTEXT_MESSAGES = 8;

function recentMessages(messages: Message[]): Message[] {
  return messages.slice(-MAX_CONTEXT_MESSAGES);
}

function summarizeScenario(scenario: Scenario, locale: AppLocale): SenseiScenarioSummary {
  const localized = localizeScenario(scenario, locale);
  return {
    id: scenario.id,
    title: localized.title,
    title_ja: localized.title_ja,
    description: localized.description,
  };
}

export function buildFallbackSenseiViewContext(screen: AppScreen): SenseiViewContext {
  return { kind: "screen", screen };
}

export function buildScenarioSelectSenseiViewContext(
  scenarios: Scenario[],
  customScenarioCount: number,
  locale: AppLocale
): SenseiViewContext {
  return {
    kind: "scenario-select",
    screen: "scenario-select",
    recommendedScenarios: scenarios.slice(0, 4).map((scenario) => summarizeScenario(scenario, locale)),
    customScenarioCount,
  };
}

export function buildScenarioPreviewSenseiViewContext(args: {
  scenario: Scenario;
  locale: AppLocale;
  level?: JLPTLevel;
  vocabReviewEnabled?: boolean;
  ttsStatus: "available" | "unavailable" | "checking";
}): SenseiViewContext {
  const localized = localizeScenario(args.scenario, args.locale);
  return {
    kind: "scenario-preview",
    screen: "conversation",
    runMode: "conversation",
    scenario: {
      id: args.scenario.id,
      title: localized.title,
      title_ja: localized.title_ja,
      description: localized.description,
      setting: localized.setting,
      characterRole: localized.character_role,
      objectives: localized.objectives,
      customPrompt: args.scenario.custom_prompt,
    },
    level: args.level,
    vocabReviewEnabled: args.vocabReviewEnabled,
    ttsStatus: args.ttsStatus,
  };
}

export function buildShadowPreviewSenseiViewContext(args: {
  scenario: Scenario;
  locale: AppLocale;
  level?: JLPTLevel;
  ttsStatus: "available" | "unavailable" | "checking";
  shadowScript?: ShadowScript | null;
}): SenseiViewContext {
  const localized = localizeScenario(args.scenario, args.locale);
  return {
    kind: "shadow-preview",
    screen: "conversation",
    runMode: "shadow",
    scenario: {
      id: args.scenario.id,
      title: localized.title,
      title_ja: localized.title_ja,
      description: localized.description,
      setting: localized.setting,
      characterRole: localized.character_role,
      objectives: localized.objectives,
      customPrompt: args.scenario.custom_prompt,
    },
    level: args.level,
    ttsStatus: args.ttsStatus,
    shadowScriptAvailable: Boolean(args.shadowScript),
    shadowScriptGeneratedAt: args.shadowScript?.generatedAt,
    scriptTurnCount: args.shadowScript?.turns.length,
    focusPhrases: args.shadowScript?.focusPhrases,
  };
}

export function buildScenarioConversationSenseiViewContext(args: {
  scenario: Scenario;
  locale: AppLocale;
  inputMode: "voice" | "text";
  conversationState: "idle" | "listening" | "transcribing" | "thinking" | "speaking";
  started: boolean;
  messages: Message[];
}): SenseiViewContext {
  const localized = localizeScenario(args.scenario, args.locale);
  return {
    kind: "scenario-conversation",
    screen: "conversation",
    runMode: "conversation",
    scenario: {
      id: args.scenario.id,
      title: localized.title,
      title_ja: localized.title_ja,
      description: localized.description,
      setting: localized.setting,
      characterRole: localized.character_role,
    },
    inputMode: args.inputMode,
    conversationState: args.conversationState,
    started: args.started,
    recentMessages: recentMessages(args.messages),
  };
}

export function buildShadowSessionSenseiViewContext(args: {
  scenario: Scenario;
  locale: AppLocale;
  script: ShadowScript;
  currentTurnNumber: number;
  totalTurns: number;
  phase: "playing" | "waiting" | "transcribing" | "result" | "complete";
  currentAssistantLine?: string;
  currentUserLine?: string;
  lastAttempt?: ShadowAttempt | null;
}): SenseiViewContext {
  const localized = localizeScenario(args.scenario, args.locale);
  return {
    kind: "shadow-session",
    screen: "conversation",
    runMode: "shadow",
    scenario: {
      id: args.scenario.id,
      title: localized.title,
      title_ja: localized.title_ja,
      description: localized.description,
      setting: localized.setting,
      characterRole: localized.character_role,
    },
    started: true,
    currentTurnNumber: args.currentTurnNumber,
    totalTurns: args.totalTurns,
    phase: args.phase,
    currentAssistantLine: args.currentAssistantLine,
    currentUserLine: args.currentUserLine,
    lastAttempt: args.lastAttempt
      ? {
          transcript: args.lastAttempt.transcript,
          result: args.lastAttempt.result,
          similarity: args.lastAttempt.similarity,
          manualAdvance: args.lastAttempt.manualAdvance,
        }
      : undefined,
    focusPhrases: args.script.focusPhrases,
  };
}

export function buildOngoingChatSenseiViewContext(args: {
  chatId: string;
  name: string;
  persona: string;
  summary: string;
  inputMode: "text" | "voice";
  messages: Message[];
}): SenseiViewContext {
  return {
    kind: "ongoing-chat",
    screen: "ongoing-chat",
    chatId: args.chatId,
    name: args.name,
    persona: args.persona,
    summary: args.summary,
    inputMode: args.inputMode,
    recentMessages: recentMessages(args.messages),
  };
}

export function buildFlashcardSenseiViewContext(args: {
  tab: "review" | "all-cards";
  dueCount: number;
  totalCards: number;
  reviewState?: "reviewing" | "complete";
  currentCard?: VocabItem | null;
  isAnswerVisible?: boolean;
  recentResults?: SenseiFlashcardResult[];
  selectedCard?: VocabItem | null;
}): SenseiViewContext {
  return {
    kind: "flashcard-review",
    screen: "flashcards",
    tab: args.tab,
    dueCount: args.dueCount,
    totalCards: args.totalCards,
    reviewState: args.reviewState,
    currentCard: args.currentCard
      ? {
          word: args.currentCard.word,
          reading: args.currentCard.reading,
          meaning: args.currentCard.meaning,
          example: args.currentCard.example,
          nextReview: args.currentCard.next_review,
        }
      : undefined,
    isAnswerVisible: args.isAnswerVisible,
    recentResults: args.recentResults?.slice(-6),
    selectedCard: args.selectedCard
      ? {
          word: args.selectedCard.word,
          reading: args.selectedCard.reading,
          meaning: args.selectedCard.meaning,
          nextReview: args.selectedCard.next_review,
        }
      : undefined,
  };
}

export function getSenseiContextLabel(context: SenseiViewContext): string {
  switch (context.kind) {
    case "scenario-select":
      return "Scenario picker";
    case "scenario-preview":
      return context.scenario.title || context.scenario.title_ja;
    case "shadow-preview":
      return `Shadow: ${context.scenario.title || context.scenario.title_ja}`;
    case "scenario-conversation":
      return context.scenario.title || context.scenario.title_ja;
    case "shadow-session":
      return `Shadow: ${context.scenario.title || context.scenario.title_ja}`;
    case "ongoing-chat":
      return context.name;
    case "flashcard-review":
      return context.tab === "review" ? "Flashcard review" : "All cards";
    case "screen":
    default:
      return context.screen;
  }
}
