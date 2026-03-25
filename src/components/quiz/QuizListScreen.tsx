import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/i18n";
import { formatDateTime, formatRelativeTime } from "@/services/locale-format";
import { getQuizzes } from "@/services/storage";
import type { Quiz } from "@/types";
import { ArrowRight, CircleHelp, Sparkles } from "lucide-react";

export function QuizListScreen({
  onOpenQuiz,
  onOpenSensei,
}: {
  onOpenQuiz: (quizId: string) => void;
  onOpenSensei: () => void;
}) {
  const { locale, t } = useI18n();
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);

  useEffect(() => {
    const loadQuizzes = () => {
      void getQuizzes().then(setQuizzes);
    };

    loadQuizzes();
    window.addEventListener("tama-data-changed", loadQuizzes);
    return () => window.removeEventListener("tama-data-changed", loadQuizzes);
  }, []);

  return (
    <div className="flex h-full flex-col overflow-auto p-4">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold">{t("common.quizzes")}</h1>
            <p className="text-sm text-muted-foreground">
              {t("quiz.listDescription", { count: quizzes.length })}
            </p>
          </div>
          <Button type="button" size="sm" onClick={onOpenSensei}>
            <Sparkles className="mr-1 size-4" />
            {t("quiz.askSensei")}
          </Button>
        </div>

        {quizzes.length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="space-y-2 text-center text-muted-foreground">
              <CircleHelp className="mx-auto size-12 opacity-30" />
              <p className="font-medium text-foreground">{t("quiz.emptyTitle")}</p>
              <p className="text-sm">{t("quiz.emptyDescription")}</p>
              <Button type="button" variant="outline" onClick={onOpenSensei}>
                {t("quiz.askSensei")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 pb-4">
            {quizzes.map((quiz) => {
              const latestAttempt = quiz.latestAttempt;

              return (
                <Card
                  key={quiz.id}
                  className="cursor-pointer gap-0 py-0 transition-colors hover:border-primary/50"
                  onClick={() => onOpenQuiz(quiz.id)}
                >
                  <CardContent className="px-5 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          <h3 className="font-medium">{quiz.title}</h3>
                          <span className="text-xs text-muted-foreground">
                            {formatRelativeTime(quiz.updatedAt, locale)}
                          </span>
                        </div>

                        <p className="line-clamp-2 text-sm text-muted-foreground">
                          {quiz.instructions}
                        </p>

                        <div className="flex flex-wrap gap-2">
                          <Badge variant="secondary" className="text-xs">
                            {t("quiz.questionCount", { count: quiz.questions.length })}
                          </Badge>
                          {latestAttempt ? (
                            <Badge variant="secondary" className="text-xs">
                              {t("quiz.score", {
                                correct: latestAttempt.correctCount,
                                total: latestAttempt.totalCount,
                              })}
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs">
                              {t("quiz.notStarted")}
                            </Badge>
                          )}
                        </div>

                        <p className="text-xs text-muted-foreground">
                          {t("quiz.updatedAt", { date: formatDateTime(quiz.updatedAt, locale) })}
                        </p>
                      </div>

                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="shrink-0"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenQuiz(quiz.id);
                        }}
                      >
                        {latestAttempt ? t("quiz.review") : t("quiz.open")}
                        <ArrowRight className="size-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
