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
import { generateFeedback } from "@/services/claude";
import { addVocabItem, getVocabulary } from "@/services/storage";
import type { Message, SessionFeedback } from "@/types";

interface OngoingFeedbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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

function parseFeedback(raw: string): SessionFeedback {
  const cleaned = raw.replace(/```json\s*/, "").replace(/```\s*$/, "").trim();
  const parsed = JSON.parse(cleaned);

  return {
    grammar_points: Array.isArray(parsed.grammar_points) ? parsed.grammar_points : [],
    vocabulary: Array.isArray(parsed.vocabulary) ? parsed.vocabulary : [],
    fluency_notes: Array.isArray(parsed.fluency_notes) ? parsed.fluency_notes : [],
    summary: {
      topics_covered: Array.isArray(parsed.summary?.topics_covered)
        ? parsed.summary.topics_covered
        : [],
      performance_rating: ["needs_work", "good", "excellent"].includes(
        parsed.summary?.performance_rating
      )
        ? parsed.summary.performance_rating
        : "good",
      next_session_hint: parsed.summary?.next_session_hint || "",
    },
  };
}

export function OngoingFeedbackDialog({
  open,
  onOpenChange,
  messages,
  chatName,
  chatPersona,
  onFeedbackGenerated,
}: OngoingFeedbackDialogProps) {
  const [feedback, setFeedback] = useState<SessionFeedback | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addedWords, setAddedWords] = useState<Set<string>>(new Set());
  const [generated, setGenerated] = useState(false);

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
        });
        if (cancelled) return;
        setFeedback(parseFeedback(raw));
        setGenerated(true);
        onFeedbackGenerated();
      } catch (err) {
        if (cancelled) return;
        console.error("Feedback generation failed:", err);
        setError(err instanceof Error ? err.message : "Failed to generate feedback");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open, generated, messages, chatName, chatPersona, onFeedbackGenerated]);

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      setFeedback(null);
      setGenerated(false);
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
                            <span className="text-red-500 line-through text-sm shrink-0">✗</span>
                            <p className="text-sm">{point.issue}</p>
                          </div>
                          <div className="flex items-start gap-2">
                            <span className="text-green-600 text-sm shrink-0">✓</span>
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
