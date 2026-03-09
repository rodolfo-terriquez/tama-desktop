import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getDueVocabulary, getLastSession, getOngoingChats, getSessions, getUserProfile } from "@/services/storage";
import type { OngoingChat, Scenario } from "@/types";
import { addDays, format, formatDistanceToNow, getISOWeek, isSameDay, startOfWeek } from "date-fns";
import hanamaruStamp from "@/assets/hanamaru.svg";

interface HomeScreenProps {
  onBrowseScenarios: () => void;
  onFlashcards: () => void;
  onContinueScenario: (scenario: Scenario) => void;
  onContinueChat: (chatId: string) => void;
  onOngoingChats: () => void;
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
  const { weekDays, completedDays, weekNumber } = useWeeklyActivity();

  const today = new Date();

  return (
    <Card className="py-0 gap-0">
      <CardContent className="py-3 px-4">
        <div className="flex items-baseline justify-between mb-2">
          <span className="text-xs font-medium">Week {weekNumber}</span>
        </div>
        <div className="grid grid-cols-7 gap-2">
          {["月", "火", "水", "木", "金", "土", "日"].map((d, i) => (
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
                    ? "bg-rose-50 border-rose-300 text-rose-700"
                    : "bg-muted/40 border-border/40 text-muted-foreground/30"
                } ${isSameDay(day, today) ? "ring-1 ring-foreground/30" : ""}`}
                title={`${format(day, "EEE, MMM d")}: ${isCompleted ? "Session completed" : "No completed session"}`}
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

function getGreetingJa(date: Date, name?: string): string {
  const hour = date.getHours();
  const baseGreeting =
    hour < 12 ? "おはようございます" :
    hour < 18 ? "こんにちは" :
    "こんばんは";
  return name ? `${baseGreeting}、${name}さん` : baseGreeting;
}

export function HomeScreen({
  onBrowseScenarios,
  onFlashcards,
  onContinueScenario,
  onContinueChat,
  onOngoingChats,
}: HomeScreenProps) {
  const [now, setNow] = useState(() => new Date());
  const [dueCount, setDueCount] = useState(0);
  const [lastScenario, setLastScenario] = useState<{
    scenario: Scenario;
    date: string;
  } | null>(null);
  const [lastPersonaChat, setLastPersonaChat] = useState<OngoingChat | null>(null);
  const [profileName, setProfileName] = useState("");
  const greetingJa = getGreetingJa(now, profileName);

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
    Promise.all([getDueVocabulary(), getLastSession(), getOngoingChats(), getUserProfile()]).then(
      ([due, recentSession, chats, profile]) => {
        setDueCount(due.length);
        setLastScenario(
          recentSession
            ? { scenario: recentSession.scenario, date: recentSession.date }
            : null
        );
        const latestChat = [...chats].sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))[0] ?? null;
        setLastPersonaChat(latestChat);
        setProfileName(profile.name?.trim() ?? "");
      }
    );
  }, []);

  return (
    <div className="flex flex-col items-center h-full p-4 overflow-auto">
      <div className="max-w-xl w-full space-y-4 py-4">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-3xl font-bold mb-2">{greetingJa}</h1>
        </div>

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
              <p className="text-sm font-medium">Last scenario</p>
              {lastScenario ? (
                <>
                  <p className="text-sm text-muted-foreground truncate mt-1">
                    {lastScenario.scenario.title} · {lastScenario.scenario.title_ja}
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    {formatDistanceToNow(new Date(lastScenario.date), { addSuffix: true })}
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground mt-1">No completed scenarios yet</p>
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
              <p className="text-sm font-medium">Last coversation</p>
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
                <p className="text-sm text-muted-foreground mt-1">No persona chats yet</p>
              )}
            </CardContent>
          </Card>

          {/* Overdue cards */}
          <Card
            className={`cursor-pointer transition-colors hover:border-primary/50 py-0 gap-0 ${
              dueCount > 0 ? "border-orange-300" : ""
            }`}
            onClick={onFlashcards}
          >
            <CardContent className="py-4 px-4 h-full">
              <p className="text-sm font-medium">Flashcards due</p>
              <p className="text-sm text-muted-foreground mt-1">
                {dueCount > 0
                  ? `${dueCount} overdue card${dueCount !== 1 ? "s" : ""}`
                  : "No overdue cards"}
              </p>
              <div className="text-2xl font-bold mt-2">
                {dueCount}
                {dueCount > 0 && (
                  <Badge variant="destructive" className="ml-1.5 text-[10px] px-1.5 py-0 align-top">
                    due
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <ActivityGrid />
      </div>
    </div>
  );
}
