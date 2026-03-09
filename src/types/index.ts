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
