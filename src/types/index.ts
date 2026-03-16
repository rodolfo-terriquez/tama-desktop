export type AppLocale = "en" | "es";
export type AppScreen =
  | "home"
  | "scenario-select"
  | "conversation"
  | "flashcards"
  | "history"
  | "stats"
  | "settings"
  | "session-complete"
  | "ongoing-chats"
  | "ongoing-chat";

// Vocabulary item for SRS
export interface VocabItem {
  id: string;
  word: string;
  reading: string;
  meaning: string;
  example: string;
  source_session: string;
  interval: number;
  ease_factor: number;
  next_review: string;
  times_seen_in_conversation: number;
  times_reviewed: number;
}

// JLPT levels
export type JLPTLevel = "N5" | "N4" | "N3" | "N2" | "N1";

// Response length preference
export type ResponseLength = "short" | "natural" | "long";

// User profile for adaptive scenarios
export interface UserProfile {
  jlpt_level: JLPTLevel;
  auto_adjust_level: boolean; // Whether to let AI adjust based on performance
  estimated_level: "beginner" | "intermediate" | "advanced";
  response_length: ResponseLength;
  include_flashcard_vocab_in_conversations: boolean;
  // Optional personal context for better conversation personalization
  name?: string;
  age?: number;
  aboutYou?: string;
  interests: string[];
  topics_covered: string[];
  recent_struggles: string[];
  total_sessions: number;
  // VOICEVOX voice settings
  voicevox_speaker_id?: number;
  voicevox_speaker_name?: string;
}

// Conversation message
export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

// Scenario for conversation practice
export interface Scenario {
  id: string;
  title: string;
  title_ja: string;
  description: string;
  setting: string;
  character_role: string;
  objectives: string[];
  isCustom?: boolean;
  custom_prompt?: string;
}

// Session feedback
export interface GrammarPoint {
  issue: string;
  correction: string;
  explanation: string;
}

export interface SessionFeedback {
  grammar_points: GrammarPoint[];
  vocabulary: Omit<VocabItem, "id" | "interval" | "ease_factor" | "next_review" | "times_seen_in_conversation" | "times_reviewed">[];
  fluency_notes: string[];
  summary: {
    topics_covered: string[];
    performance_rating: "needs_work" | "good" | "excellent";
    next_session_hint: string;
  };
}

// Full session record
export interface Session {
  id: string;
  date: string;
  scenario: Scenario;
  messages: Message[];
  feedback: SessionFeedback | null;
  duration_seconds: number;
}

// VOICEVOX speaker/style
export interface VoicevoxSpeaker {
  name: string;
  speaker_uuid: string;
  styles: {
    name: string;
    id: number;
  }[];
}

// Ongoing persistent chat
export interface OngoingChat {
  id: string;
  name: string;
  persona: string;
  messages: Message[];
  summary: string;
  createdAt: string;
  lastActiveAt: string;
  totalMessages: number;
  lastFeedbackAtTotal: number;
}

// SRS rating
export type SRSRating = "again" | "hard" | "good" | "easy";

export interface SenseiThread {
  id: string;
  messages: Message[];
  summary: string;
  createdAt: string;
  lastActiveAt: string;
  totalMessages: number;
}

export interface AccountPreferences {
  appLocale: AppLocale;
  apiOnboardingDismissed: boolean;
  llmProvider: "anthropic" | "openrouter";
  openRouterModel: string;
  displayMode: "light" | "dark" | "system";
  ttsEngine: "voicevox" | "sbv2";
  ttsVoiceId: string | null;
  sbv2BaseUrl: string;
  transcriptionEngine: "local" | "openai";
}

export interface AccountBundleV1 {
  schemaVersion: 1;
  exportedAt: string;
  appVersion: string;
  profile: UserProfile;
  sessions: Session[];
  vocabulary: VocabItem[];
  ongoingChats: OngoingChat[];
  customScenarios: Scenario[];
  preferences: AccountPreferences;
  sensei?: SenseiThread;
}

export interface SenseiScenarioSummary {
  id: string;
  title: string;
  title_ja: string;
  description: string;
}

export interface SenseiFlashcardResult {
  word: string;
  rating: SRSRating;
}

export type SenseiViewContext =
  | {
      kind: "screen";
      screen: AppScreen;
    }
  | {
      kind: "scenario-select";
      screen: "scenario-select";
      recommendedScenarios: SenseiScenarioSummary[];
      customScenarioCount: number;
    }
  | {
      kind: "scenario-preview";
      screen: "conversation";
      scenario: SenseiScenarioSummary & {
        setting: string;
        characterRole: string;
        objectives: string[];
        customPrompt?: string;
      };
      level?: JLPTLevel;
      vocabReviewEnabled?: boolean;
      ttsStatus: "available" | "unavailable" | "checking";
    }
  | {
      kind: "scenario-conversation";
      screen: "conversation";
      scenario: SenseiScenarioSummary & {
        setting: string;
        characterRole: string;
      };
      inputMode: "voice" | "text";
      conversationState: "idle" | "listening" | "transcribing" | "thinking" | "speaking";
      started: boolean;
      recentMessages: Message[];
    }
  | {
      kind: "ongoing-chat";
      screen: "ongoing-chat";
      chatId: string;
      name: string;
      persona: string;
      summary: string;
      inputMode: "text" | "voice";
      recentMessages: Message[];
    }
  | {
      kind: "flashcard-review";
      screen: "flashcards";
      tab: "review" | "all-cards";
      dueCount: number;
      totalCards: number;
      reviewState?: "reviewing" | "complete";
      currentCard?: {
        word: string;
        reading: string;
        meaning: string;
        example: string;
        nextReview: string;
      };
      isAnswerVisible?: boolean;
      recentResults?: SenseiFlashcardResult[];
      selectedCard?: {
        word: string;
        reading: string;
        meaning: string;
        nextReview: string;
      };
    };

export interface SenseiRequestContext {
  locale: AppLocale;
  view: SenseiViewContext;
}
