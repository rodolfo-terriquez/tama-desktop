import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useI18n } from "@/i18n";
import { generateFeedback } from "@/services/claude";
import { FeedbackParseError, parseFeedbackResponse } from "@/services/feedback-parser";
import { generateDailyStudyPlan } from "@/services/study-plan";
import { addVocabItem, saveSession, getVocabulary, getUserProfile, updateUserProfile } from "@/services/storage";
import type { Message, Scenario, SessionFeedback, Session } from "@/types";

interface FeedbackScreenProps {
  messages: Message[];
  scenario: Scenario;
  onStartNewSession: () => void;
  onGoHome: () => void;
}

const RATING_CONFIG = {
  needs_work: { key: "history.needsWork", variant: "destructive" as const, icon: "📝" },
  good: { key: "history.good", variant: "default" as const, icon: "👍" },
  excellent: { key: "history.excellent", variant: "secondary" as const, icon: "🌟" },
} as const;

export function FeedbackScreen({
  messages,
  scenario,
  onStartNewSession,
  onGoHome,
}: FeedbackScreenProps) {
  const { locale, t } = useI18n();
  const [feedback, setFeedback] = useState<SessionFeedback | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addedWords, setAddedWords] = useState<Set<string>>(new Set());
  const [sessionSaved, setSessionSaved] = useState(false);

  const saveSessionData = useCallback(
    async (fb: SessionFeedback) => {
      if (sessionSaved) return;

      const firstMsg = messages[0];
      const lastMsg = messages[messages.length - 1];
      const startTime = new Date(firstMsg?.timestamp || Date.now());
      const endTime = new Date(lastMsg?.timestamp || Date.now());
      const durationSeconds = Math.round(
        (endTime.getTime() - startTime.getTime()) / 1000
      );

      const session: Session = {
        id: crypto.randomUUID(),
        date: new Date().toISOString(),
        scenario,
        messages,
        feedback: fb,
        duration_seconds: durationSeconds,
        run_mode: "conversation",
      };

      await saveSession(session);

      const profile = await getUserProfile();
      const newTopics = fb.summary.topics_covered.filter(
        (t) => !profile.topics_covered.includes(t)
      );
      const newStruggles = fb.grammar_points
        .slice(0, 3)
        .map((g) => g.explanation);

      await updateUserProfile({
        total_sessions: profile.total_sessions + 1,
        topics_covered: [...profile.topics_covered, ...newTopics].slice(-20),
        recent_struggles: newStruggles.length > 0 ? newStruggles : profile.recent_struggles,
      });

      void generateDailyStudyPlan().catch((error) => {
        console.error("Failed to refresh daily study plan after session:", error);
      });

      setSessionSaved(true);
    },
    [messages, scenario, sessionSaved]
  );

  useEffect(() => {
    let cancelled = false;

    async function fetchFeedback() {
      setIsLoading(true);
      setError(null);

      try {
        const raw = await generateFeedback(messages, {
          title: scenario.title,
          description: scenario.description,
        }, locale);

        if (cancelled) return;

        const parsed = parseFeedbackResponse(raw);
        setFeedback(parsed);
        await saveSessionData(parsed);
      } catch (err) {
        if (cancelled) return;
        console.error("Feedback generation failed:", err);
        setError(
          err instanceof FeedbackParseError ? t("feedback.generateFailed")
          : err instanceof Error ? err.message
          : t("feedback.generateFailed")
        );
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    if (messages.length > 0) {
      fetchFeedback();
    } else {
      setIsLoading(false);
      setError(t("feedback.noConversation"));
    }

    return () => {
      cancelled = true;
    };
  }, [locale, messages, saveSessionData, scenario, t]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAddToSRS = useCallback(
    async (vocabIndex: number) => {
      if (!feedback) return;
      const vocab = feedback.vocabulary[vocabIndex];
      if (!vocab) return;

      const existing = await getVocabulary();
      const alreadyExists = existing.some(
        (v) => v.word === vocab.word && v.meaning === vocab.meaning
      );
      if (alreadyExists) {
        setAddedWords((prev) => new Set(prev).add(vocab.word));
        return;
      }

      await addVocabItem({
        word: vocab.word,
        reading: vocab.reading,
        meaning: vocab.meaning,
        example: vocab.example,
        source_session: vocab.source_session || new Date().toISOString().split("T")[0],
      });

      setAddedWords((prev) => new Set(prev).add(vocab.word));
    },
    [feedback]
  );

  const handleAddAllToSRS = useCallback(async () => {
    if (!feedback) return;
    for (let i = 0; i < feedback.vocabulary.length; i++) {
      if (!addedWords.has(feedback.vocabulary[i].word)) {
        await handleAddToSRS(i);
      }
    }
  }, [feedback, addedWords, handleAddToSRS]);

  if (isLoading) {
    return <FeedbackSkeleton messageCount={messages.length} scenarioTitle={scenario.title} />;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4">
        <Card className="w-full max-w-lg">
          <CardContent className="py-8 space-y-4 text-center">
            <h2 className="text-xl font-semibold">{t("feedback.sessionComplete")}</h2>
            <p className="text-muted-foreground">
              {t("feedback.messagesInScenario", { count: messages.length, title: scenario.title })}
            </p>
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
            <div className="flex gap-2 justify-center pt-2">
              <Button variant="outline" onClick={onGoHome}>
                {t("common.home")}
              </Button>
              <Button onClick={onStartNewSession}>{t("feedback.newSession")}</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!feedback) return null;

  const rating = RATING_CONFIG[feedback.summary.performance_rating];
  const userMsgCount = messages.filter((m) => m.role === "user").length;

  return (
    <ScrollArea className="h-full">
      <div className="max-w-3xl mx-auto p-4 pb-12 space-y-6">
        {/* Summary Card */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xl">{t("feedback.sessionFeedback")}</CardTitle>
              <Badge variant={rating.variant} className="text-sm px-3 py-1">
                {rating.icon} {t(rating.key)}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {scenario.title_ja} — {t("feedback.exchanges", { count: userMsgCount })}
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {feedback.summary.topics_covered.length > 0 && (
              <div>
                <p className="text-sm font-medium mb-1.5">{t("feedback.topicsCovered")}</p>
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
                <p className="text-sm font-medium mb-1">{t("feedback.nextTime")}</p>
                <p className="text-sm text-muted-foreground">
                  {feedback.summary.next_session_hint}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Grammar Points */}
        {feedback.grammar_points.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">{t("feedback.grammarPoints")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {feedback.grammar_points.map((point, i) => (
                <div key={i}>
                  {i > 0 && <Separator className="mb-4" />}
                  <div className="space-y-1.5">
                    <div className="flex items-start gap-2">
                      <span className="text-destructive line-through text-sm mt-0.5 shrink-0">✗</span>
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
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Vocabulary */}
        {feedback.vocabulary.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">{t("feedback.vocabulary")}</CardTitle>
                {feedback.vocabulary.length > 1 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleAddAllToSRS}
                    disabled={feedback.vocabulary.every((v) => addedWords.has(v.word))}
                  >
                    {feedback.vocabulary.every((v) => addedWords.has(v.word))
                      ? t("feedback.allAdded")
                      : t("feedback.addAllToSrs")}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {feedback.vocabulary.map((vocab, i) => (
                <div
                  key={i}
                  className="flex items-start justify-between gap-3 p-3 rounded-lg bg-muted/50"
                >
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-lg font-medium">{vocab.word}</span>
                      {vocab.reading && vocab.reading !== vocab.word && (
                        <span className="text-sm text-muted-foreground">
                          {vocab.reading}
                        </span>
                      )}
                    </div>
                    <p className="text-sm">{vocab.meaning}</p>
                    {vocab.example && (
                      <p className="text-xs text-muted-foreground italic">
                        {vocab.example}
                      </p>
                    )}
                  </div>
                  <Button
                    variant={addedWords.has(vocab.word) ? "ghost" : "outline"}
                    size="sm"
                    className="shrink-0"
                    onClick={() => handleAddToSRS(i)}
                    disabled={addedWords.has(vocab.word)}
                  >
                    {addedWords.has(vocab.word) ? t("feedback.added") : t("feedback.addToSrs")}
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Fluency Notes */}
        {feedback.fluency_notes.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">{t("feedback.fluencyNotes")}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {feedback.fluency_notes.map((note, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className="text-muted-foreground mt-0.5 shrink-0">•</span>
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Actions */}
        <div className="flex gap-3 justify-center pt-2">
          <Button variant="outline" onClick={onGoHome}>
            {t("common.home")}
          </Button>
          <Button onClick={onStartNewSession}>{t("feedback.startNewSession")}</Button>
        </div>
      </div>
    </ScrollArea>
  );
}

function FeedbackSkeleton({
  messageCount,
  scenarioTitle,
}: {
  messageCount: number;
  scenarioTitle: string;
}) {
  const { t } = useI18n();
  return (
    <div className="max-w-3xl mx-auto p-4 pb-12 space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-56" />
            </div>
            <Skeleton className="h-7 w-24 rounded-full" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent className="space-y-4">
          {[1, 2].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-28" />
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex justify-between items-center p-3 rounded-lg bg-muted/50">
              <div className="space-y-1.5 flex-1">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-4 w-40" />
              </div>
              <Skeleton className="h-8 w-16 rounded-md" />
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="text-center">
        <p className="text-sm text-muted-foreground animate-pulse">
          {t("feedback.analyzing", { count: messageCount, title: scenarioTitle })}
        </p>
      </div>
    </div>
  );
}
