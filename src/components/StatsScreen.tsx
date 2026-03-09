import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessions, getVocabulary } from "@/services/storage";
import hanamaruStamp from "@/assets/hanamaru.svg";
import type { Session, VocabItem } from "@/types";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addMonths, startOfMonth } from "date-fns";

function isSameMonth(date: Date, year: number, month: number): boolean {
  return date.getFullYear() === year && date.getMonth() === month;
}

function parseSourceSessionDate(item: VocabItem): Date | null {
  const raw = item.source_session?.trim();
  if (!raw) return null;

  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct;

  const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!m) return null;
  const fallback = new Date(m[1]);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

export function StatsScreen() {
  const currentMonthStart = startOfMonth(new Date());
  const [viewedMonth, setViewedMonth] = useState<Date>(currentMonthStart);
  const year = viewedMonth.getFullYear();
  const month = viewedMonth.getMonth();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [vocab, setVocab] = useState<VocabItem[]>([]);

  useEffect(() => {
    Promise.all([getSessions(), getVocabulary()]).then(([loadedSessions, loadedVocab]) => {
      setSessions(loadedSessions);
      setVocab(loadedVocab);
    });
  }, []);

  const monthName = useMemo(
    () => new Date(year, month, 1).toLocaleString("default", { month: "long", year: "numeric" }),
    [year, month]
  );
  const canGoNextMonth = viewedMonth < currentMonthStart;

  const sessionCountsByDay = useMemo(() => {
    const counts = new Map<number, number>();
    for (const session of sessions) {
      const d = new Date(session.date);
      if (isSameMonth(d, year, month)) {
        counts.set(d.getDate(), (counts.get(d.getDate()) ?? 0) + 1);
      }
    }
    return counts;
  }, [sessions, year, month]);

  const totalSessionsThisMonth = useMemo(
    () => [...sessionCountsByDay.values()].reduce((a, b) => a + b, 0),
    [sessionCountsByDay]
  );

  const newFlashcardsThisMonth = useMemo(() => {
    let count = 0;
    for (const item of vocab) {
      const d = parseSourceSessionDate(item);
      if (d && isSameMonth(d, year, month)) {
        count++;
      }
    }
    return count;
  }, [vocab, year, month]);

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthStartOffset = (new Date(year, month, 1).getDay() + 6) % 7; // Monday = 0
  const cells: Array<number | null> = [
    ...Array.from({ length: monthStartOffset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div className="flex flex-col h-full p-4 overflow-auto">
      <div className="w-full max-w-2xl mx-auto space-y-4 py-4">
        <div className="grid gap-3 md:grid-cols-2">
          <Card className="py-0 gap-0">
            <CardContent className="py-4">
              <p className="text-sm text-muted-foreground">Sessions in month</p>
              <p className="text-3xl font-semibold mt-1">{totalSessionsThisMonth}</p>
            </CardContent>
          </Card>
          <Card className="py-0 gap-0">
            <CardContent className="py-4">
              <p className="text-sm text-muted-foreground">New flashcards added</p>
              <p className="text-3xl font-semibold mt-1">{newFlashcardsThisMonth}</p>
            </CardContent>
          </Card>
        </div>

        <Card className="py-0 gap-0">
          <CardHeader className="pt-5 pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">{monthName}</CardTitle>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setViewedMonth((m) => addMonths(m, -1))}
                  aria-label="Previous month"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setViewedMonth((m) => addMonths(m, 1))}
                  disabled={!canGoNextMonth}
                  aria-label="Next month"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="mt-3 grid grid-cols-7 gap-1.5">
              {["月", "火", "水", "木", "金", "土", "日"].map((d) => (
                <div key={d} className="text-[10px] text-center text-muted-foreground/70">
                  {d}
                </div>
              ))}

              {cells.map((day, idx) => {
                if (day === null) {
                  return <div key={`empty-${idx}`} className="h-12" />;
                }

                const hasSession = (sessionCountsByDay.get(day) ?? 0) > 0;
                const sessionCount = sessionCountsByDay.get(day) ?? 0;
                return (
                  <div
                    key={day}
                    className={`h-12 rounded-md border relative flex items-center justify-center ${
                      hasSession
                        ? "bg-rose-50 border-rose-300"
                        : "bg-muted/35 border-border/40"
                    }`}
                    title={`${sessionCount} sessions`}
                  >
                    <span className="absolute left-1.5 top-1 text-[10px] text-muted-foreground">
                      {day}
                    </span>
                    {hasSession ? (
                      <img
                        src={hanamaruStamp}
                        alt="Hanamaru"
                        className="-rotate-12 w-8 h-8 object-contain select-none pointer-events-none"
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
