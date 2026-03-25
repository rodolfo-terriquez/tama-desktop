import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Toast } from "@/components/ui/toast";
import { useI18n } from "@/i18n";
import {
  addVocabItem,
  getFlashcardReviewSessions,
  getOngoingChats,
  getQuizzes,
  getSessions,
  getVocabulary,
} from "@/services/storage";
import { formatDateTime, formatRelativeTime, formatTime } from "@/services/locale-format";
import type {
  FlashcardReviewSession,
  Message,
  OngoingChat,
  Quiz,
  Session,
  SessionFeedback,
} from "@/types";
import { CheckCircle2, Copy, XCircle } from "lucide-react";

const RATING_CONFIG = {
  needs_work: { key: "history.needsWork", variant: "destructive-soft" as const },
  good: { key: "history.good", variant: "success" as const },
  excellent: { key: "history.excellent", variant: "accent" as const },
} as const;

const FLASHCARD_RATING_KEYS = {
  again: "flashcards.again",
  hard: "flashcards.hard",
  good: "flashcards.good",
  easy: "flashcards.easy",
} as const;

type DetailTab = "conversation" | "feedback";

type HistoryEntry =
  | {
      kind: "session";
      id: string;
      sortDate: string;
      session: Session;
    }
  | {
      kind: "ongoing-chat";
      id: string;
      sortDate: string;
      chat: OngoingChat;
      messages: Message[];
    }
  | {
      kind: "flashcard-review";
      id: string;
      sortDate: string;
      review: FlashcardReviewSession;
    }
  | {
      kind: "quiz";
      id: string;
      sortDate: string;
      quiz: Quiz;
    };

function getFeedbackVocabKey(word: string, meaning: string): string {
  return `${word}:::${meaning}`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

function normalizeSessionFeedback(feedback: Session["feedback"]): SessionFeedback | null {
  if (!feedback) return null;

  const performanceRating =
    feedback.summary?.performance_rating === "needs_work" ||
    feedback.summary?.performance_rating === "good" ||
    feedback.summary?.performance_rating === "excellent"
      ? feedback.summary.performance_rating
      : "good";

  return {
    grammar_points: Array.isArray(feedback.grammar_points) ? feedback.grammar_points : [],
    vocabulary: Array.isArray(feedback.vocabulary) ? feedback.vocabulary : [],
    fluency_notes: Array.isArray(feedback.fluency_notes) ? feedback.fluency_notes : [],
    summary: {
      topics_covered: Array.isArray(feedback.summary?.topics_covered)
        ? feedback.summary.topics_covered
        : [],
      performance_rating: performanceRating,
      next_session_hint:
        typeof feedback.summary?.next_session_hint === "string"
          ? feedback.summary.next_session_hint
          : "",
    },
  };
}

function buildHistoryEntries(
  sessions: Session[],
  chats: OngoingChat[],
  flashcardReviewSessions: FlashcardReviewSession[],
  quizzes: Quiz[]
): HistoryEntry[] {
  const sessionEntries: HistoryEntry[] = sessions.map((session) => ({
    kind: "session",
    id: session.id,
    sortDate: session.date,
    session,
  }));

  const ongoingEntries: HistoryEntry[] = chats
    .map((chat) => {
      const pendingStart = Math.max(0, chat.lastFeedbackAtTotal ?? 0);
      const pendingMessages = chat.messages.slice(pendingStart);

      if (pendingMessages.length === 0) {
        return null;
      }

      return {
        kind: "ongoing-chat" as const,
        id: `ongoing-chat-live:${chat.id}`,
        sortDate: chat.lastActiveAt,
        chat,
        messages: pendingMessages,
      };
    })
    .filter((entry): entry is Extract<HistoryEntry, { kind: "ongoing-chat" }> => Boolean(entry));

  const flashcardEntries: HistoryEntry[] = flashcardReviewSessions.map((review) => ({
    kind: "flashcard-review",
    id: review.id,
    sortDate: review.date,
    review,
  }));

  const quizEntries: HistoryEntry[] = quizzes
    .filter((quiz) => Boolean(quiz.latestAttempt))
    .map((quiz) => ({
      kind: "quiz" as const,
      id: `quiz:${quiz.id}`,
      sortDate: quiz.latestAttempt?.completedAt ?? quiz.updatedAt,
      quiz,
    }));

  return [...sessionEntries, ...ongoingEntries, ...flashcardEntries, ...quizEntries].sort((a, b) =>
    b.sortDate.localeCompare(a.sortDate)
  );
}

function getConversationMessages(entry: HistoryEntry): Message[] {
  if (entry.kind === "session") {
    return entry.session.messages;
  }
  if (entry.kind === "ongoing-chat") {
    return entry.messages;
  }
  return [];
}

export function SessionHistory() {
  const { t } = useI18n();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [vocabCount, setVocabCount] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>("conversation");
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const loadHistory = useCallback(() => {
    void Promise.all([
      getSessions(),
      getOngoingChats(),
      getFlashcardReviewSessions(),
      getQuizzes(),
    ]).then(([sessions, chats, reviewSessions, quizzes]) => {
      setEntries(buildHistoryEntries(sessions, chats, reviewSessions, quizzes));
    });
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    getVocabulary().then((v) => setVocabCount(v.length));
  }, []);

  const refreshVocabCount = useCallback(() => {
    getVocabulary().then((v) => setVocabCount(v.length));
  }, []);

  const handleToggle = (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
    } else {
      setExpandedId(id);
      setActiveTab("conversation");
    }
  };

  const showMessage = (type: "success" | "error", text: string, duration = 3000) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), duration);
  };

  const fallbackCopyText = (text: string) => {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  };

  const handleCopyEntry = async (entry: HistoryEntry) => {
    const transcript = getConversationMessages(entry)
      .map((msg) => `${msg.role === "user" ? "You" : "AI"}: ${msg.content}`)
      .join("\n\n");

    if (!transcript) {
      showMessage("error", t("history.noConversationToCopy"));
      return;
    }

    try {
      await navigator.clipboard.writeText(transcript);
      showMessage("success", t("history.conversationCopied"));
      return;
    } catch (error) {
      console.warn("Clipboard API copy failed, falling back:", error);
    }

    const copied = fallbackCopyText(transcript);
    if (copied) {
      showMessage("success", t("history.conversationCopied"));
    } else {
      showMessage("error", t("history.conversationCopyFailed"), 5000);
    }
  };

  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto p-4">
      {message && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <Toast tone={message.type === "success" ? "success" : "destructive"}>
            {message.text}
          </Toast>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-xl font-semibold">{t("common.history")}</h1>
          <span className="text-sm text-muted-foreground">
            {entries.length} {t("history.activities")} · {vocabCount} {t("common.words")}
          </span>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-2">
            <p className="text-lg font-medium">{t("history.noSessions")}</p>
            <p className="text-sm text-muted-foreground">
              {t("history.noSessionsDescription")}
            </p>
          </div>
        </div>
      ) : (
        <ScrollArea className="flex-1 [&>[data-slot=scroll-area-viewport]]:!overflow-x-hidden">
          <div className="space-y-3 pb-4 min-w-0">
            {entries.map((entry) => (
              <HistoryCard
                key={entry.id}
                entry={entry}
                isExpanded={expandedId === entry.id}
                activeTab={activeTab}
                onToggle={() => handleToggle(entry.id)}
                onTabChange={setActiveTab}
                onCopy={() => void handleCopyEntry(entry)}
                onShowMessage={showMessage}
                onVocabularyAdded={refreshVocabCount}
              />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

function HistoryCard({
  entry,
  isExpanded,
  activeTab,
  onToggle,
  onTabChange,
  onCopy,
  onShowMessage,
  onVocabularyAdded,
}: {
  entry: HistoryEntry;
  isExpanded: boolean;
  activeTab: DetailTab;
  onToggle: () => void;
  onTabChange: (tab: DetailTab) => void;
  onCopy: () => void;
  onShowMessage: (type: "success" | "error", text: string, duration?: number) => void;
  onVocabularyAdded: () => void;
}) {
  const { t } = useI18n();
  const feedback = entry.kind === "session" ? normalizeSessionFeedback(entry.session.feedback) : null;
  const rating = feedback?.summary.performance_rating;
  const ratingConfig = rating ? RATING_CONFIG[rating] : null;
  const messages = getConversationMessages(entry);
  const canCopy = messages.length > 0;
  const hasFeedbackTab = Boolean(feedback);
  const isPracticeSession =
    entry.kind === "session" &&
    (entry.session.run_mode === "shadow" ||
      (!entry.session.run_mode &&
        entry.session.feedback === null &&
        !entry.session.scenario.id.startsWith("ongoing-chat:")));

  const title =
    entry.kind === "session"
      ? entry.session.scenario.title
      : entry.kind === "ongoing-chat"
        ? entry.chat.name
        : entry.kind === "flashcard-review"
          ? t("history.flashcardReviewTitle")
          : entry.quiz.title;
  const titleJa = entry.kind === "session" ? entry.session.scenario.title_ja : "";
  const subtitle =
    entry.kind === "ongoing-chat"
      ? entry.chat.persona
      : entry.kind === "session" && entry.session.scenario.id.startsWith("ongoing-chat:")
        ? entry.session.scenario.description
        : entry.kind === "quiz"
          ? entry.quiz.instructions
        : "";
  const userMessages = entry.kind === "session"
    ? entry.session.messages.filter((m) => m.role === "user").length
    : 0;
  const latestAttempt = entry.kind === "quiz" ? entry.quiz.latestAttempt : null;

  const metaParts = [
    formatDateTime(new Date(entry.sortDate)),
    entry.kind === "session"
      ? formatDuration(entry.session.duration_seconds)
      : entry.kind === "flashcard-review"
        ? formatDuration(entry.review.duration_seconds)
        : entry.kind === "quiz"
          ? t("quiz.questionCount", { count: entry.quiz.questions.length })
        : null,
    entry.kind === "session"
      ? t("feedback.exchanges", { count: userMessages })
      : entry.kind === "ongoing-chat"
        ? t("history.messageCount", { count: entry.messages.length })
        : entry.kind === "flashcard-review"
          ? t("history.cardsReviewed", { count: entry.review.results.length })
          : latestAttempt
            ? t("quiz.score", {
                correct: latestAttempt.correctCount,
                total: latestAttempt.totalCount,
              })
            : null,
  ].filter((value): value is string => Boolean(value));

  return (
    <Card className="overflow-hidden min-w-0 !py-0 !gap-0">
      <CardContent className="p-0 min-w-0">
        <div className="px-4 pt-3 pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2 flex-wrap">
                <h3 className="font-medium text-sm">{title}</h3>
                {titleJa && (
                  <span className="text-xs text-muted-foreground">{titleJa}</span>
                )}
              </div>

              {subtitle && (
                <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
                  {subtitle}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-1.5 mt-1 text-xs text-muted-foreground">
                {metaParts.map((part, index) => (
                  <span key={`${entry.id}-meta-${index}`} className="contents">
                    {index > 0 && <span>·</span>}
                    <span>{part}</span>
                  </span>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
              {isPracticeSession ? (
                <Badge variant="accent" className="text-[10px]">
                  {t("shadow.modeLabel")}
                </Badge>
              ) : ratingConfig ? (
                <Badge variant={ratingConfig.variant} className="text-[10px]">
                  {t(ratingConfig.key)}
                </Badge>
              ) : entry.kind === "ongoing-chat" ? (
                <Badge variant="outline" className="text-[10px]">
                  {t("history.noFeedbackYet")}
                </Badge>
              ) : entry.kind === "flashcard-review" ? (
                <Badge variant="accent" className="text-[10px]">
                  {t("common.review")}
                </Badge>
              ) : entry.kind === "quiz" ? (
                <Badge variant="accent" className="text-[10px]">
                  {t("common.quizzes")}
                </Badge>
              ) : null}
              <span className="text-[10px] text-muted-foreground">
                {formatRelativeTime(new Date(entry.sortDate))}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={onToggle}
                className="h-7 text-xs shrink-0"
              >
                {isExpanded ? t("common.hide") : t("common.details")}
                <svg
                  className={`ml-1 w-3 h-3 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </Button>
            </div>
          </div>
        </div>

        {isExpanded && (
          <div className="border-t overflow-hidden">
            {hasFeedbackTab ? (
              <>
                <div className="flex border-b">
                  <button
                    onClick={() => onTabChange("conversation")}
                    className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                      activeTab === "conversation"
                        ? "text-foreground border-b-2 border-primary"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t("common.conversation")}
                  </button>
                  <button
                    onClick={() => onTabChange("feedback")}
                    className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                      activeTab === "feedback"
                        ? "text-foreground border-b-2 border-primary"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t("common.feedback")}
                    {feedback && feedback.grammar_points.length > 0 && (
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        ({feedback.grammar_points.length})
                      </span>
                    )}
                  </button>
                </div>
                <div className="px-5 py-4 max-h-[28rem] overflow-y-auto overflow-x-hidden min-w-0">
                  {activeTab === "conversation" ? (
                    <ConversationPanel messages={messages} onCopy={canCopy ? onCopy : undefined} />
                  ) : (
                    <FeedbackView
                      session={entry.kind === "session" ? entry.session : null}
                      onShowMessage={onShowMessage}
                      onVocabularyAdded={onVocabularyAdded}
                    />
                  )}
                </div>
              </>
            ) : (
              <div className="px-5 py-4 max-h-[28rem] overflow-y-auto overflow-x-hidden min-w-0">
                {entry.kind === "flashcard-review" ? (
                  <FlashcardReviewView review={entry.review} />
                ) : entry.kind === "quiz" ? (
                  <QuizAttemptView quiz={entry.quiz} />
                ) : (
                  <ConversationPanel messages={messages} onCopy={canCopy ? onCopy : undefined} />
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ConversationPanel({
  messages,
  onCopy,
}: {
  messages: Message[];
  onCopy?: () => void;
}) {
  const { t } = useI18n();

  return (
    <div className="space-y-3">
      {onCopy && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={onCopy} className="h-7 text-xs shrink-0">
            <Copy className="size-3.5" />
            {t("common.copy")}
          </Button>
        </div>
      )}
      <ConversationView messages={messages} />
    </div>
  );
}

function ConversationView({ messages }: { messages: Message[] }) {
  const { t } = useI18n();
  if (messages.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        {t("history.noMessagesRecorded")}
      </p>
    );
  }

  return (
    <div className="space-y-3 min-w-0">
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`flex min-w-0 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
        >
          <div
            className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm min-w-0 ${
              msg.role === "user"
                ? "bg-primary text-primary-foreground rounded-br-md"
                : "bg-muted rounded-bl-md"
            }`}
            style={{ overflowWrap: "anywhere" }}
          >
            <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
            <p
              className={`text-[10px] mt-1 ${
                msg.role === "user" ? "text-primary-foreground/60" : "text-muted-foreground"
              }`}
            >
              {formatTime(new Date(msg.timestamp))}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function FlashcardReviewView({ review }: { review: FlashcardReviewSession }) {
  const { t } = useI18n();

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t("history.cardsReviewed", { count: review.results.length })}
      </p>
      <div className="space-y-2">
        {review.results.map((result, index) => (
          <div key={`${review.id}-${index}`} className="rounded-lg bg-muted/40 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">{result.word}</span>
              <Badge variant="outline">
                {t(FLASHCARD_RATING_KEYS[result.rating])}
              </Badge>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function QuizAttemptView({ quiz }: { quiz: Quiz }) {
  const { t } = useI18n();
  const latestAttempt = quiz.latestAttempt;

  if (!latestAttempt) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        {t("quiz.notStarted")}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{t("quiz.score", {
          correct: latestAttempt.correctCount,
          total: latestAttempt.totalCount,
        })}</Badge>
        <span className="text-xs text-muted-foreground">
          {formatDateTime(latestAttempt.completedAt)}
        </span>
      </div>

      <div className="space-y-3">
        {latestAttempt.results.map((result, index) => (
          <div key={`${latestAttempt.id}-${result.questionId}`} className="rounded-lg bg-muted/40 p-3 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("quiz.questionNumber", { number: index + 1 })}
                </p>
                <p className="text-sm leading-relaxed">{result.prompt}</p>
              </div>
              <Badge variant={result.isCorrect ? "success" : "outline"} className="shrink-0">
                {result.isCorrect ? (
                  <>
                    <CheckCircle2 className="size-3.5" />
                    {t("quiz.correct")}
                  </>
                ) : (
                  <>
                    <XCircle className="size-3.5" />
                    {t("quiz.incorrect")}
                  </>
                )}
              </Badge>
            </div>
            <div className="space-y-1 text-sm">
              <p>
                <span className="text-muted-foreground">{t("quiz.yourAnswer")}:</span>{" "}
                <span>{result.userAnswer || t("common.none")}</span>
              </p>
              {!result.isCorrect ? (
                <p>
                  <span className="text-muted-foreground">{t("quiz.correctAnswer")}:</span>{" "}
                  <span>{result.correctAnswer}</span>
                </p>
              ) : null}
              <p className="text-muted-foreground">{result.explanation}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FeedbackView({
  session,
  onShowMessage,
  onVocabularyAdded,
}: {
  session: Session | null;
  onShowMessage: (type: "success" | "error", text: string, duration?: number) => void;
  onVocabularyAdded: () => void;
}) {
  const { t } = useI18n();
  const feedback = normalizeSessionFeedback(session?.feedback ?? null);
  const [addedWords, setAddedWords] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    async function loadExistingVocabulary() {
      if (!feedback) return;
      const existing = await getVocabulary();
      if (cancelled) return;

      const added = new Set(
        feedback.vocabulary
          .filter((vocab) =>
            existing.some((item) => item.word === vocab.word && item.meaning === vocab.meaning)
          )
          .map((vocab) => getFeedbackVocabKey(vocab.word, vocab.meaning))
      );
      setAddedWords(added);
    }

    loadExistingVocabulary().catch(console.error);

    return () => {
      cancelled = true;
    };
  }, [feedback]);

  if (!feedback) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        {t("common.none")}
      </p>
    );
  }

  const hasGrammar = feedback.grammar_points.length > 0;
  const hasVocab = feedback.vocabulary.length > 0;
  const hasFluency = feedback.fluency_notes.length > 0;

  const handleAddToSRS = useCallback(
    async (vocabIndex: number) => {
      const vocab = feedback.vocabulary[vocabIndex];
      if (!vocab) return;

      const key = getFeedbackVocabKey(vocab.word, vocab.meaning);
      if (addedWords.has(key)) return;

      const existing = await getVocabulary();
      const alreadyExists = existing.some(
        (item) => item.word === vocab.word && item.meaning === vocab.meaning
      );

      if (alreadyExists) {
        setAddedWords((prev) => new Set(prev).add(key));
        onShowMessage("success", `${vocab.word} ${t("feedback.added").replace(" ✓", "")}`);
        return;
      }

      await addVocabItem({
        word: vocab.word,
        reading: vocab.reading,
        meaning: vocab.meaning,
        example: vocab.example,
        source_session: vocab.source_session || new Date().toISOString().split("T")[0],
      });

      setAddedWords((prev) => new Set(prev).add(key));
      onVocabularyAdded();
      onShowMessage("success", `${vocab.word} ${t("feedback.added").replace(" ✓", "")}`);
    },
    [addedWords, feedback.vocabulary, onShowMessage, onVocabularyAdded, t]
  );

  const handleAddAllToSRS = useCallback(async () => {
    for (let i = 0; i < feedback.vocabulary.length; i++) {
      const vocab = feedback.vocabulary[i];
      const key = getFeedbackVocabKey(vocab.word, vocab.meaning);
      if (addedWords.has(key)) continue;
      await handleAddToSRS(i);
    }
  }, [addedWords, feedback.vocabulary, handleAddToSRS]);

  return (
    <div className="space-y-5">
      {feedback.summary.topics_covered.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
            {t("feedback.topicsCovered")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {feedback.summary.topics_covered.map((topic, i) => (
              <Badge key={i} variant="outline" className="text-xs">
                {topic}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {feedback.summary.next_session_hint && (
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
            {t("feedback.nextTime")}
          </p>
          <p className="text-sm">{feedback.summary.next_session_hint}</p>
        </div>
      )}

      {hasGrammar && (
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
            {t("feedback.grammarPoints")}
          </p>
          <div className="space-y-3">
            {feedback.grammar_points.map((point, i) => (
              <div key={i} className="rounded-lg bg-muted/50 p-3 space-y-1.5">
                <div className="flex items-start gap-2">
                  <span className="text-destructive text-sm mt-0.5 shrink-0">✗</span>
                  <p className="text-sm">{point.issue}</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-success text-sm mt-0.5 shrink-0">✓</span>
                  <p className="text-sm font-medium">{point.correction}</p>
                </div>
                <p className="text-xs text-muted-foreground pl-5">
                  {point.explanation}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {hasVocab && (
        <>
          {hasGrammar && <Separator />}
          <div>
            <div className="flex items-center justify-between gap-3 mb-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {t("feedback.vocabulary")} ({feedback.vocabulary.length})
              </p>
              {feedback.vocabulary.length > 1 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleAddAllToSRS()}
                  disabled={feedback.vocabulary.every((vocab) =>
                    addedWords.has(getFeedbackVocabKey(vocab.word, vocab.meaning))
                  )}
                  className="h-7 text-xs shrink-0"
                >
                  {feedback.vocabulary.every((vocab) =>
                    addedWords.has(getFeedbackVocabKey(vocab.word, vocab.meaning))
                  )
                    ? t("feedback.allAdded")
                    : t("feedback.addAllToSrs")}
                </Button>
              )}
            </div>
            <div className="space-y-2">
              {feedback.vocabulary.map((vocab, i) => (
                <div key={i} className="rounded-lg bg-muted/50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-base font-medium">{vocab.word}</span>
                        {vocab.reading && vocab.reading !== vocab.word && (
                          <span className="text-sm text-muted-foreground">{vocab.reading}</span>
                        )}
                        <span className="text-sm">— {vocab.meaning}</span>
                      </div>
                      {vocab.example && (
                        <p className="text-xs text-muted-foreground mt-1 italic">
                          {vocab.example}
                        </p>
                      )}
                    </div>
                    <Button
                      variant={
                        addedWords.has(getFeedbackVocabKey(vocab.word, vocab.meaning))
                          ? "ghost"
                          : "outline"
                      }
                      size="sm"
                      className="shrink-0"
                      onClick={() => void handleAddToSRS(i)}
                      disabled={addedWords.has(getFeedbackVocabKey(vocab.word, vocab.meaning))}
                    >
                      {addedWords.has(getFeedbackVocabKey(vocab.word, vocab.meaning))
                        ? t("feedback.added")
                        : t("feedback.addToSrs")}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {hasFluency && (
        <>
          {(hasGrammar || hasVocab) && <Separator />}
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              {t("feedback.fluencyNotes")}
            </p>
            <ul className="space-y-1.5">
              {feedback.fluency_notes.map((note, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="text-muted-foreground mt-0.5 shrink-0">•</span>
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {!hasGrammar && !hasVocab && !hasFluency && (
        <p className="text-sm text-muted-foreground text-center py-2">
          {t("common.none")}
        </p>
      )}
    </div>
  );
}
