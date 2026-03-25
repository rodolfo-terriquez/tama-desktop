import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n";
import { emitDataChanged } from "@/services/app-events";
import { buildQuizSenseiViewContext } from "@/services/sensei-context";
import { getQuiz, saveQuiz } from "@/services/storage";
import { cn } from "@/lib/utils";
import type { Quiz, QuizAttempt, QuizQuestion, SenseiViewContext } from "@/types";

function normalizeQuizAnswer(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function isQuizAnswerCorrect(answer: string, correctAnswer: string): boolean {
  return normalizeQuizAnswer(answer) === normalizeQuizAnswer(correctAnswer);
}

function QuizQuestionInput({
  question,
  value,
  disabled,
  placeholder,
  onChange,
}: {
  question: QuizQuestion;
  value: string;
  disabled: boolean;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  if (question.type === "fill_blank") {
    return (
      <Input
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-11 rounded-xl border-border/70 bg-background/70"
      />
    );
  }

  if (question.type === "dropdown") {
    return (
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="flex h-11 w-full rounded-xl border border-border/70 bg-background/70 px-3 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <option value="">{placeholder}</option>
        {question.options?.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div className="space-y-2">
      {question.options?.map((option) => (
        <label
          key={option}
          className={cn(
            "flex cursor-pointer items-start gap-2 rounded-xl border border-border/70 bg-background/50 px-3 py-3 text-sm transition-colors",
            value === option && "border-primary/50 bg-primary/10",
            disabled && "cursor-default"
          )}
        >
          <input
            type="radio"
            name={question.id}
            value={option}
            checked={value === option}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            className="mt-0.5"
          />
          <span>{option}</span>
        </label>
      ))}
    </div>
  );
}

export function QuizScreen({
  quizId,
  onBack,
  onContextChange,
}: {
  quizId: string;
  onBack: () => void;
  onContextChange?: (context: SenseiViewContext) => void;
}) {
  const { t } = useI18n();
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [showAnswers, setShowAnswers] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void getQuiz(quizId)
      .then((loaded) => {
        if (cancelled) {
          return;
        }

        setQuiz(loaded);
        setError(loaded ? null : t("quiz.notFound"));

        if (!loaded) {
          return;
        }

        const nextAnswers = loaded.latestAttempt?.answers
          ? { ...loaded.latestAttempt.answers }
          : Object.fromEntries(loaded.questions.map((question) => [question.id, ""]));
        setAnswers(nextAnswers);
        setSubmitted(Boolean(loaded.latestAttempt));
        setShowAnswers(Boolean(loaded.latestAttempt));
        onContextChange?.(buildQuizSenseiViewContext(loaded));
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : t("quiz.loadFailed"));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [onContextChange, quizId, t]);

  const correctCount = useMemo(() => {
    if (!quiz) {
      return 0;
    }

    return quiz.questions.filter((question) =>
      isQuizAnswerCorrect(answers[question.id] ?? "", question.correctAnswer)
    ).length;
  }, [answers, quiz]);

  if (error && !quiz) {
    return (
      <div className="mx-auto flex h-full max-w-3xl flex-col px-4 py-4">
        <Card>
          <CardContent className="space-y-4 py-8">
            <p className="text-sm text-destructive">{error}</p>
            <Button type="button" variant="outline" onClick={onBack}>
              {t("common.back")}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!quiz) {
    return (
      <div className="mx-auto flex h-full max-w-3xl items-center justify-center px-4 py-4 text-sm text-muted-foreground">
        {t("app.loading")}
      </div>
    );
  }

  const submitQuiz = async () => {
    setIsSaving(true);
    setError(null);

    try {
      const now = new Date().toISOString();
      const attempt: QuizAttempt = {
        id: crypto.randomUUID(),
        quizId: quiz.id,
        completedAt: now,
        answers,
        correctCount,
        totalCount: quiz.questions.length,
        results: quiz.questions.map((question) => {
          const userAnswer = answers[question.id] ?? "";
          return {
            questionId: question.id,
            prompt: question.prompt,
            userAnswer,
            correctAnswer: question.correctAnswer,
            isCorrect: isQuizAnswerCorrect(userAnswer, question.correctAnswer),
            explanation: question.explanation,
          };
        }),
      };

      const updatedQuiz: Quiz = {
        ...quiz,
        updatedAt: now,
        latestAttempt: attempt,
      };

      await saveQuiz(updatedQuiz);
      emitDataChanged("quiz-write");
      setQuiz(updatedQuiz);
      setSubmitted(true);
      setShowAnswers(false);
      onContextChange?.(buildQuizSenseiViewContext(updatedQuiz));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t("quiz.saveFailed"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col px-4 py-4">
      <div className="flex flex-1 min-h-0 flex-col gap-4">
        <Card className="gap-0 py-0">
          <CardContent className="px-4 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="text-xl">{quiz.title}</CardTitle>
                <p className="text-sm text-muted-foreground">{quiz.instructions}</p>
                {submitted ? (
                  <p className="text-xs font-medium text-primary">
                    {t("quiz.score", { correct: correctCount, total: quiz.questions.length })}
                  </p>
                ) : null}
              </div>
              <Button type="button" variant="outline" size="sm" onClick={onBack}>
                {t("common.back")}
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="space-y-4 pb-8">
            {quiz.questions.map((question, index) => {
              const answer = answers[question.id] ?? "";
              const correct = isQuizAnswerCorrect(answer, question.correctAnswer);

              return (
                <Card key={question.id} className="gap-0 py-0">
                  <CardContent className="space-y-4 px-4 py-4">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-foreground">
                        {t("quiz.questionNumber", { number: index + 1 })}
                      </p>
                      <p className="text-sm leading-relaxed text-foreground">{question.prompt}</p>
                    </div>

                    <QuizQuestionInput
                      question={question}
                      value={answer}
                      disabled={isSaving}
                      placeholder={t("quiz.selectAnswer")}
                      onChange={(nextValue) => {
                        setAnswers((current) => ({
                          ...current,
                          [question.id]: nextValue,
                        }));
                      }}
                    />

                    {submitted ? (
                      <div
                        className={cn(
                          "space-y-2 rounded-xl border px-3 py-3 text-sm",
                          correct
                            ? "border-emerald-500/30 bg-emerald-500/10 text-foreground"
                            : "border-amber-500/30 bg-amber-500/10 text-foreground"
                        )}
                      >
                        <p className="font-medium">
                          {correct ? t("quiz.correct") : t("quiz.incorrect")}
                        </p>
                        {answer ? (
                          <p className="text-xs text-muted-foreground">
                            {t("quiz.yourAnswer")}: {answer}
                          </p>
                        ) : null}
                        {!correct || showAnswers ? (
                          <p className="text-xs text-muted-foreground">
                            {t("quiz.correctAnswer")}: {question.correctAnswer}
                          </p>
                        ) : null}
                        <p className="text-xs leading-relaxed text-muted-foreground">{question.explanation}</p>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}

            {error ? (
              <Card className="gap-0 border-destructive/30 py-0">
                <CardContent className="px-4 py-3 text-sm text-destructive">{error}</CardContent>
              </Card>
            ) : null}
          </div>
        </div>

        <Card className="gap-0 py-0">
          <CardContent className="flex flex-wrap items-center gap-2 px-4 py-3">
            <Button type="button" onClick={() => void submitQuiz()} disabled={isSaving}>
              {t("quiz.checkAnswers")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setSubmitted(true);
                setShowAnswers(true);
              }}
              disabled={isSaving}
            >
              {t("quiz.showAnswers")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setAnswers(Object.fromEntries(quiz.questions.map((question) => [question.id, ""])));
                setSubmitted(false);
                setShowAnswers(false);
              }}
              disabled={isSaving}
            >
              {t("quiz.tryAgain")}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
