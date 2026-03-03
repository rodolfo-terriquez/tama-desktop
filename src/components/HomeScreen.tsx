import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getDueVocabulary, getVocabulary, getSessions, getOngoingChats } from "@/services/storage";

interface HomeScreenProps {
  onBrowseScenarios: () => void;
  onFlashcards: () => void;
  onHistory: () => void;
}

function useMonthlyActivity() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const [data, setData] = useState<{
    daysInMonth: number;
    firstDayOfWeek: number;
    counts: Map<number, number>;
    totalActive: number;
    activeDays: number;
    monthName: string;
  }>({
    daysInMonth: new Date(year, month + 1, 0).getDate(),
    firstDayOfWeek: new Date(year, month, 1).getDay(),
    counts: new Map(),
    totalActive: 0,
    activeDays: 0,
    monthName: now.toLocaleString("default", { month: "long" }),
  });

  useEffect(() => {
    async function load() {
      const [sessions, chats] = await Promise.all([getSessions(), getOngoingChats()]);
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const counts = new Map<number, number>();

      for (const session of sessions) {
        const d = new Date(session.date);
        if (d.getFullYear() === year && d.getMonth() === month) {
          counts.set(d.getDate(), (counts.get(d.getDate()) ?? 0) + 1);
        }
      }

      for (const chat of chats) {
        if (!chat.lastActiveAt) continue;
        const d = new Date(chat.lastActiveAt);
        if (d.getFullYear() === year && d.getMonth() === month) {
          counts.set(d.getDate(), (counts.get(d.getDate()) ?? 0) + 1);
        }
      }

      const firstDayOfWeek = new Date(year, month, 1).getDay();
      const totalActive = [...counts.values()].reduce((a, b) => a + b, 0);
      const activeDays = counts.size;
      const monthName = now.toLocaleString("default", { month: "long" });

      setData({ daysInMonth, firstDayOfWeek, counts, totalActive, activeDays, monthName });
    }
    load();
  }, []);

  return data;
}

function ActivityGrid() {
  const { daysInMonth, firstDayOfWeek, counts, totalActive, activeDays, monthName } = useMonthlyActivity();

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDayOfWeek; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const today = new Date().getDate();

  function intensity(day: number): string {
    const count = counts.get(day) ?? 0;
    if (count === 0) return "bg-muted/60";
    if (count === 1) return "bg-emerald-300 dark:bg-emerald-700";
    if (count <= 3) return "bg-emerald-400 dark:bg-emerald-600";
    return "bg-emerald-500 dark:bg-emerald-500";
  }

  return (
    <Card className="py-0 gap-0">
      <CardContent className="py-3 px-4">
        <div className="flex items-baseline justify-between mb-2">
          <span className="text-xs font-medium">{monthName}</span>
          <span className="text-[10px] text-muted-foreground">
            {activeDays} active day{activeDays !== 1 ? "s" : ""} · {totalActive} session{totalActive !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="grid grid-cols-7 gap-[3px]">
          {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
            <div key={i} className="text-[9px] text-center text-muted-foreground/60 leading-none mb-0.5">
              {d}
            </div>
          ))}
          {cells.map((day, i) => (
            <div
              key={i}
              className={`aspect-square rounded-[3px] ${
                day === null
                  ? "bg-transparent"
                  : `${intensity(day)} ${day === today ? "ring-1 ring-foreground/30" : ""}`
              }`}
              title={day ? `${monthName} ${day}: ${counts.get(day) ?? 0} session(s)` : undefined}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function HomeScreen({
  onBrowseScenarios,
  onFlashcards,
  onHistory,
}: HomeScreenProps) {
  const [dueCount, setDueCount] = useState(0);
  const [totalVocab, setTotalVocab] = useState(0);
  const [totalSessions, setTotalSessions] = useState(0);

  useEffect(() => {
    Promise.all([getDueVocabulary(), getVocabulary(), getSessions()]).then(
      ([due, vocab, sessions]) => {
        setDueCount(due.length);
        setTotalVocab(vocab.length);
        setTotalSessions(sessions.length);
      }
    );
  }, []);

  return (
    <div className="flex flex-col items-center justify-center h-full p-4">
      <div className="max-w-md w-full space-y-6">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-3xl font-bold mb-2">Welcome to Tama</h1>
          <p className="text-muted-foreground">
            Practice Japanese conversation with AI-powered scenarios
          </p>
        </div>

        {/* Main actions */}
        <div className="grid gap-3">
          <Button
            size="lg"
            className="w-full"
            onClick={onBrowseScenarios}
          >
            Browse Scenarios
          </Button>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3">
          <Card
            className={`cursor-pointer transition-colors hover:border-primary/50 ${
              dueCount > 0 ? "border-orange-300" : ""
            }`}
            onClick={onFlashcards}
          >
            <CardContent className="py-3 px-3 text-center">
              <div className="text-2xl font-bold">
                {dueCount}
                {dueCount > 0 && (
                  <Badge variant="destructive" className="ml-1.5 text-[10px] px-1.5 py-0 align-top">
                    due
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {totalVocab} word{totalVocab !== 1 && "s"} total
              </p>
            </CardContent>
          </Card>

          <Card className="cursor-pointer transition-colors hover:border-primary/50" onClick={onHistory}>
            <CardContent className="py-3 px-3 text-center">
              <div className="text-2xl font-bold">{totalSessions}</div>
              <p className="text-xs text-muted-foreground mt-0.5">
                session{totalSessions !== 1 && "s"}
              </p>
            </CardContent>
          </Card>

          <Card
            className={`cursor-pointer transition-colors hover:border-primary/50 ${
              dueCount > 0 ? "border-orange-300" : ""
            }`}
            onClick={onFlashcards}
          >
            <CardContent className="py-3 px-3 text-center">
              <div className="text-lg font-bold">
                {dueCount > 0 ? "Review" : "✓"}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {dueCount > 0 ? `${dueCount} card${dueCount !== 1 ? "s" : ""}` : "All clear"}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Monthly activity */}
        <ActivityGrid />
      </div>
    </div>
  );
}
