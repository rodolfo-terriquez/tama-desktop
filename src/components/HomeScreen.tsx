import { useState, useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { SCENARIOS, localizeScenario } from "@/data/scenarios";
import { buildHomeSenseiViewContext } from "@/services/sensei-context";
import { ensureDailyStudyPlan } from "@/services/study-plan";
import { getCustomScenarios, getDueVocabulary, getLastSession, getOngoingChats, getSessions, getUserProfile } from "@/services/storage";
import { useI18n } from "@/i18n";
import { formatRelativeTime, formatWeekdayMonthDay, getWeekdayLabels } from "@/services/locale-format";
import type { OngoingChat, Scenario, SenseiViewContext, StudyPlan, StudyPlanTask } from "@/types";
import { addDays, format, getISOWeek, isSameDay, startOfWeek } from "date-fns";
import { BookOpenText, Mic, Sparkles } from "lucide-react";
import hanamaruStamp from "@/assets/hanamaru.svg";

interface HomeScreenProps {
  onBrowseScenarios: () => void;
  onFlashcards: () => void;
  onContinueScenario: (scenario: Scenario) => void;
  onContinueChat: (chatId: string) => void;
  onOngoingChats: () => void;
  onOpenSensei: (prompt?: string) => void;
  onContextChange?: (context: SenseiViewContext) => void;
}

function useWeeklyActivity() {
  const now = new Date();
  const [data, setData] = useState<{
    weekDays: Date[];
    completedDays: Set<string>;
    weekNumber: number;
  }>({
    weekDays: Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(now, { weekStartsOn: 1 }), i)),
    completedDays: new Set(),
    weekNumber: getISOWeek(now),
  });

  useEffect(() => {
    async function load() {
      const sessions = await getSessions();
      const now = new Date();
      const weekStart = startOfWeek(now, { weekStartsOn: 1 });
      const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
      const weekKeys = new Set(weekDays.map((day) => format(day, "yyyy-MM-dd")));
      const completedDays = new Set<string>();

      for (const session of sessions) {
        const key = format(new Date(session.date), "yyyy-MM-dd");
        if (weekKeys.has(key)) {
          completedDays.add(key);
        }
      }

      setData({
        weekDays,
        completedDays,
        weekNumber: getISOWeek(now),
      });
    }
    load();
  }, []);

  return data;
}

function ActivityGrid() {
  const { locale, t } = useI18n();
  const { weekDays, completedDays, weekNumber } = useWeeklyActivity();

  const today = new Date();

  return (
    <Card className="py-0 gap-0">
      <CardContent className="py-3 px-4">
        <div className="flex items-baseline justify-between mb-2">
          <span className="text-xs font-medium">{t("home.week", { weekNumber })}</span>
        </div>
        <div className="grid grid-cols-7 gap-2">
          {getWeekdayLabels(locale).map((d, i) => (
            <div key={i} className="text-[9px] text-center text-muted-foreground/60 leading-none mb-0.5">
              {d}
            </div>
          ))}
          {weekDays.map((day) => {
            const dateKey = format(day, "yyyy-MM-dd");
            const isCompleted = completedDays.has(dateKey);
            return (
              <div
                key={dateKey}
                className={`h-16 rounded-md border flex items-center justify-center ${
                  isCompleted
                    ? "bg-primary/12 border-primary/28 text-primary"
                    : "bg-muted/40 border-border/40 text-muted-foreground/30"
                } ${isSameDay(day, today) ? "ring-1 ring-primary/45" : ""}`}
                title={`${formatWeekdayMonthDay(day, locale)}: ${isCompleted ? t("home.sessionCompleted") : t("home.noCompletedSession")}`}
              >
                {isCompleted ? (
                  <img
                    src={hanamaruStamp}
                    alt="Hanamaru"
                    className="-rotate-12 w-12 h-12 object-contain select-none pointer-events-none"
                  />
                ) : (
                  <span className="text-[16px] leading-none select-none">・</span>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function getGreeting(date: Date, name: string | undefined): string {
  const hour = date.getHours();
  const baseGreeting = hour < 12
    ? "おはようございます"
    : hour < 18
      ? "こんにちは"
      : "こんばんは";
  return name ? `${baseGreeting}、${name}` : baseGreeting;
}

function TodayPlanCard({
  studyPlan,
  isLoading,
  onTaskAction,
}: {
  studyPlan: StudyPlan | null;
  isLoading: boolean;
  onTaskAction: (task: StudyPlanTask) => void;
}) {
  const { t } = useI18n();

  return (
    <Card className="py-0 gap-0">
      <CardContent className="px-4 py-3 space-y-2">
        <div>
          <p className="text-sm font-medium">{t("home.todaysPlan")}</p>
        </div>

        {studyPlan ? (
          <div>
            {studyPlan.tasks.map((task, index) => (
              <div key={task.id}>
                {index > 0 ? <Separator className="my-1.5" /> : null}
                <div className="flex items-center justify-between gap-3 py-1">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      <span className="mr-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {t("home.planStep", { number: index + 1 })}
                      </span>
                      <span className="font-medium">{task.title}</span>
                      <span className="mx-2 text-muted-foreground">-</span>
                      <span className="text-muted-foreground">{task.description}</span>
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={task.kind === "flashcards" ? "outline" : "default"}
                    className="h-8 shrink-0 px-3"
                    onClick={() => onTaskAction(task)}
                  >
                    {task.kind === "flashcards" ? <BookOpenText className="size-4" /> : null}
                    {task.kind === "scenario" ? <Mic className="size-4" /> : null}
                    {task.kind === "sensei" ? <Sparkles className="size-4" /> : null}
                    {task.ctaLabel}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : isLoading ? (
          <p className="text-sm text-muted-foreground">{t("home.generatingPlan")}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function HomeScreen({
  onBrowseScenarios,
  onFlashcards,
  onContinueScenario,
  onContinueChat,
  onOngoingChats,
  onOpenSensei,
  onContextChange,
}: HomeScreenProps) {
  const { locale, t } = useI18n();
  const [now, setNow] = useState(() => new Date());
  const [dueCount, setDueCount] = useState(0);
  const [lastScenario, setLastScenario] = useState<{
    scenario: Scenario;
    date: string;
  } | null>(null);
  const [lastPersonaChat, setLastPersonaChat] = useState<OngoingChat | null>(null);
  const [profileName, setProfileName] = useState("");
  const [appVersion, setAppVersion] = useState("");
  const [studyPlan, setStudyPlan] = useState<StudyPlan | null>(null);
  const [studyPlanLoading, setStudyPlanLoading] = useState(true);
  const [availableScenarios, setAvailableScenarios] = useState<Scenario[]>(SCENARIOS);
  const greeting = getGreeting(now, profileName);

  useEffect(() => {
    const loadHomeData = () => {
      setStudyPlanLoading(true);
      Promise.all([
        getDueVocabulary(),
        getLastSession(),
        getOngoingChats(),
        getUserProfile(),
        ensureDailyStudyPlan(),
        getCustomScenarios(),
      ]).then(
        ([due, recentSession, chats, profile, plan, customScenarios]) => {
          setDueCount(due.length);
          setLastScenario(
            recentSession
              ? { scenario: recentSession.scenario, date: recentSession.date }
              : null
          );
          const latestChat = [...chats].sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))[0] ?? null;
          setLastPersonaChat(latestChat);
          setProfileName(profile.name?.trim() ?? "");
          setStudyPlan(plan);
          setAvailableScenarios([...SCENARIOS, ...customScenarios]);
          setStudyPlanLoading(false);
        }
      ).catch((error) => {
        console.error("Failed to load home data:", error);
        setStudyPlan(null);
        setStudyPlanLoading(false);
      });
    };

    loadHomeData();
    window.addEventListener("tama-data-changed", loadHomeData);
    return () => window.removeEventListener("tama-data-changed", loadHomeData);
  }, []);

  useEffect(() => {
    onContextChange?.(buildHomeSenseiViewContext(studyPlan));
  }, [onContextChange, studyPlan]);

  useEffect(() => {
    const tick = () => setNow(new Date());
    const intervalId = window.setInterval(tick, 60_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    getVersion()
      .then((version) => setAppVersion(version))
      .catch(() => setAppVersion(""));
  }, []);

  const handlePlanTaskAction = (task: StudyPlanTask) => {
    switch (task.target.screen) {
      case "flashcards":
        onFlashcards();
        return;
      case "sensei":
        onOpenSensei(task.target.prompt);
        return;
      case "scenario": {
        const scenarioId = task.target.scenarioId;
        const scenario = availableScenarios.find((item) => item.id === scenarioId);
        if (scenario) {
          onContinueScenario(scenario);
          return;
        }
        onBrowseScenarios();
        return;
      }
    }
  };

  return (
    <div className="flex flex-col items-center h-full p-4 overflow-auto">
      <div className="max-w-3xl w-full space-y-6 py-5">
        {/* Header */}
        <div className="space-y-7">
          <div className="text-left">
            <h1 className="text-3xl font-bold">{greeting}</h1>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              className="sm:w-auto"
              onClick={onBrowseScenarios}
            >
              <Mic className="size-4" />
              {t("home.startNextScenario")}
            </Button>
            <Button
              variant="outline"
              className="sm:w-auto"
              onClick={() => {
                if (lastPersonaChat) {
                  onContinueChat(lastPersonaChat.id);
                } else {
                  onOngoingChats();
                }
              }}
              disabled={!lastPersonaChat}
            >
              <Sparkles className="size-4" />
              {t("home.resumeConversation")}
            </Button>
          </div>
        </div>

        <TodayPlanCard
          studyPlan={studyPlan}
          isLoading={studyPlanLoading}
          onTaskAction={handlePlanTaskAction}
        />

        <div className="grid gap-3 md:grid-cols-3">
          {/* Quick resume: last scenario */}
          <Card
            className="py-0 gap-0 cursor-pointer transition-colors hover:border-primary/50"
            onClick={() => {
              if (lastScenario) {
                onContinueScenario(lastScenario.scenario);
              } else {
                onBrowseScenarios();
              }
            }}
          >
            <CardContent className="py-4 px-4 h-full">
              <p className="text-sm font-medium">{t("home.lastScenario")}</p>
              {lastScenario ? (
                <>
                  <p className="text-sm text-muted-foreground truncate mt-1">
                    {localizeScenario(lastScenario.scenario, locale).title} · {lastScenario.scenario.title_ja}
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    {formatRelativeTime(new Date(lastScenario.date))}
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground mt-1">{t("home.noCompletedScenarios")}</p>
              )}
            </CardContent>
          </Card>

          {/* Quick resume: last conversation */}
          <Card
            className="py-0 gap-0 cursor-pointer transition-colors hover:border-primary/50"
            onClick={() => {
              if (lastPersonaChat) {
                onContinueChat(lastPersonaChat.id);
              } else {
                onOngoingChats();
              }
            }}
          >
            <CardContent className="py-4 px-4 h-full">
              <p className="text-sm font-medium">{t("home.lastConversation")}</p>
              {lastPersonaChat ? (
                <>
                  <p className="text-sm text-muted-foreground truncate mt-1">
                    {lastPersonaChat.name}
                  </p>
                  <p className="text-xs text-muted-foreground truncate mt-2">
                    {lastPersonaChat.persona}
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground mt-1">{t("home.noPersonaChats")}</p>
              )}
            </CardContent>
          </Card>

          {/* Overdue cards */}
          <Card
            className={`cursor-pointer transition-colors hover:border-primary/50 py-0 gap-0 ${
              dueCount > 0 ? "border-review-due/45" : ""
            }`}
            onClick={onFlashcards}
          >
            <CardContent className="py-4 px-4 h-full">
              <p className="text-sm font-medium">{t("home.flashcardsDue")}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {dueCount > 0
                  ? dueCount === 1
                    ? t("home.oneOverdueCard")
                    : t("home.multipleOverdueCards", { count: dueCount })
                  : t("home.noOverdueCards")}
              </p>
              <div className="text-2xl font-bold mt-2">
                {dueCount}
                {dueCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="ml-1.5 border border-review-due/20 bg-review-due-soft px-1.5 py-0 text-[10px] align-top text-review-due-soft-foreground"
                  >
                    {t("common.due")}
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <ActivityGrid />
        <p className="text-center text-xs text-muted-foreground">
          {t("common.version")} {appVersion ? `v${appVersion}` : t("app.loading")}
        </p>
      </div>
    </div>
  );
}
