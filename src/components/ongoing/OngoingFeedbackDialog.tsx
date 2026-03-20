import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useI18n } from "@/i18n";
import { generateFeedback } from "@/services/claude";
import { FeedbackParseError, parseFeedbackResponse } from "@/services/feedback-parser";
import {
  addVocabItem,
  getUserProfile,
  getVocabulary,
  saveSession,
  updateUserProfile,
} from "@/services/storage";
import type { Message, Session, SessionFeedback } from "@/types";

interface OngoingFeedbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chatId: string;
  messages: Message[];
  chatName: string;
  chatPersona: string;
  onFeedbackGenerated: () => void;
}

const RATING_CONFIG = {
  needs_work: { label: "Needs Work", variant: "destructive" as const },
  good: { label: "Good", variant: "default" as const },
  excellent: { label: "Excellent", variant: "secondary" as const },
};

export function OngoingFeedbackDialog({
  open,
  onOpenChange,
  chatId,
  messages,
  chatName,
  chatPersona,
  onFeedbackGenerated,
}: OngoingFeedbackDialogProps) {
  const { locale } = useI18n();
  const [feedback, setFeedback] = useState<SessionFeedback | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addedWords, setAddedWords] = useState<Set<string>>(new Set());
  const [generated, setGenerated] = useState(false);
  const [sessionSaved, setSessionSaved] = useState(false);

  const saveSessionData = useCallback(
    async (fb: SessionFeedback) => {
      if (sessionSaved || messages.length === 0) return;

      const firstMsg = messages[0];
      const lastMsg = messages[messages.length - 1];
      const startTime = new Date(firstMsg?.timestamp || Date.now());
      const endTime = new Date(lastMsg?.timestamp || Date.now());
      const durationSeconds = Math.max(
        0,
        Math.round((endTime.getTime() - startTime.getTime()) / 1000)
      );

      const session: Session = {
        id: crypto.randomUUID(),
        date: new Date().toISOString(),
        scenario: {
          id: `ongoing-chat:${chatId}`,
          title: chatName,
          title_ja: "",
          description: chatPersona,
          setting: "Ongoing conversation",
          character_role: chatPersona,
          objectives: [],
        },
        messages,
        feedback: fb,
        duration_seconds: durationSeconds,
      };

      await saveSession(session);

      const profile = await getUserProfile();
      const newTopics = fb.summary.topics_covered.filter(
        (topic) => !profile.topics_covered.includes(topic)
      );
      const newStruggles = fb.grammar_points
        .slice(0, 3)
        .map((point) => point.explanation);

      await updateUserProfile({
        total_sessions: profile.total_sessions + 1,
        topics_covered: [...profile.topics_covered, ...newTopics].slice(-20),
        recent_struggles: newStruggles.length > 0 ? newStruggles : profile.recent_struggles,
      });

      setSessionSaved(true);
    },
    [chatId, chatName, chatPersona, messages, sessionSaved]
  );

  useEffect(() => {
    if (!open || generated || messages.length === 0) return;

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    (async () => {
      try {
        const raw = await generateFeedback(messages, {
          name: chatName,
          persona: chatPersona,
        }, locale);
        if (cancelled) return;
        const parsed = parseFeedbackResponse(raw);
        setFeedback(parsed);
        setGenerated(true);
        setIsLoading(false);

        try {
          await saveSessionData(parsed);
          if (!cancelled) {
            onFeedbackGenerated();
          }
        } catch (saveErr) {
          console.error("Failed to save ongoing feedback session:", saveErr);
          if (!cancelled) {
            setError(
              saveErr instanceof Error ? saveErr.message : "Failed to save feedback to history"
            );
          }
        }
      } catch (err) {
        if (cancelled) return;
        console.error("Feedback generation failed:", err);
        setError(
          err instanceof FeedbackParseError
            ? "Failed to generate feedback"
            : err instanceof Error
              ? err.message
              : "Failed to generate feedback"
        );
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open, generated, messages, chatName, chatPersona, locale, onFeedbackGenerated, saveSessionData]);

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      setFeedback(null);
      setGenerated(false);
      setSessionSaved(false);
      setError(null);
      setAddedWords(new Set());
    }
    onOpenChange(nextOpen);
  };

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

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] !flex !flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>Conversation Feedback</DialogTitle>
          <DialogDescription>
            Analyzing {messages.length} messages with {chatName}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
          {isLoading && <FeedbackSkeleton />}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {feedback && (
            <>
              {/* Summary */}
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Summary</CardTitle>
                    <Badge variant={RATING_CONFIG[feedback.summary.performance_rating].variant} className="text-xs">
                      {RATING_CONFIG[feedback.summary.performance_rating].label}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {feedback.summary.topics_covered.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {feedback.summary.topics_covered.map((topic, i) => (
                        <Badge key={i} variant="outline" className="text-xs">
                          {topic}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {feedback.summary.next_session_hint && (
                    <p className="text-sm text-muted-foreground">
                      {feedback.summary.next_session_hint}
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Grammar Points */}
              {feedback.grammar_points.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Grammar Points</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {feedback.grammar_points.map((point, i) => (
                      <div key={i}>
                        {i > 0 && <Separator className="mb-3" />}
                        <div className="space-y-1">
                          <div className="flex items-start gap-2">
                            <span className="text-destructive line-through text-sm shrink-0">✗</span>
                            <p className="text-sm">{point.issue}</p>
                          </div>
                          <div className="flex items-start gap-2">
                            <span className="text-success text-sm shrink-0">✓</span>
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
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">Vocabulary</CardTitle>
                      {feedback.vocabulary.length > 1 && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleAddAllToSRS}
                          disabled={feedback.vocabulary.every((v) => addedWords.has(v.word))}
                        >
                          {feedback.vocabulary.every((v) => addedWords.has(v.word))
                            ? "All Added"
                            : "Add All to SRS"}
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {feedback.vocabulary.map((vocab, i) => (
                      <div
                        key={i}
                        className="flex items-start justify-between gap-3 p-2.5 rounded-lg bg-muted/50"
                      >
                        <div className="space-y-0.5 min-w-0 flex-1">
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <span className="text-base font-medium">{vocab.word}</span>
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
                          {addedWords.has(vocab.word) ? "Added ✓" : "+ SRS"}
                        </Button>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Fluency Notes */}
              {feedback.fluency_notes.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Fluency Notes</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-1.5">
                      {feedback.fluency_notes.map((note, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <span className="text-muted-foreground shrink-0">•</span>
                          <span>{note}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FeedbackSkeleton() {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))}
        </CardContent>
      </Card>
      <div className="text-center py-2">
        <p className="text-sm text-muted-foreground animate-pulse">
          Generating feedback...
        </p>
      </div>
    </div>
  );
}
