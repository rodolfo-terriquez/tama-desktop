import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { getSessions, getVocabulary } from "@/services/storage";
import { format, formatDistanceToNow } from "date-fns";
import type { Session } from "@/types";

const RATING_CONFIG = {
  needs_work: { label: "Needs Work", class: "bg-red-100 text-red-800" },
  good: { label: "Good", class: "bg-green-100 text-green-800" },
  excellent: { label: "Excellent", class: "bg-blue-100 text-blue-800" },
};

type DetailTab = "conversation" | "feedback";

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

export function SessionHistory() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [vocabCount, setVocabCount] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>("conversation");

  useEffect(() => {
    getSessions().then((s) => setSessions(s.sort((a, b) => b.date.localeCompare(a.date))));
  }, []);
  useEffect(() => {
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

  return (
    <div className="flex flex-col h-full max-w-2xl mx-auto p-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-4">
        <span className="text-sm text-muted-foreground">
          {sessions.length} session{sessions.length !== 1 && "s"} · {vocabCount} word{vocabCount !== 1 && "s"}
        </span>
      </div>

      {sessions.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-2">
            <p className="text-lg font-medium">No sessions yet</p>
            <p className="text-sm text-muted-foreground">
              Complete a conversation to see your history here.
            </p>
          </div>
        </div>
      ) : (
        <ScrollArea className="flex-1 [&>[data-slot=scroll-area-viewport]]:!overflow-x-hidden">
          <div className="space-y-3 pb-4 min-w-0">
            {sessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                isExpanded={expandedId === session.id}
                activeTab={activeTab}
                onToggle={() => handleToggle(session.id)}
                onTabChange={setActiveTab}
              />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

function SessionCard({
  session,
  isExpanded,
  activeTab,
  onToggle,
  onTabChange,
}: {
  session: Session;
  isExpanded: boolean;
  activeTab: DetailTab;
  onToggle: () => void;
  onTabChange: (tab: DetailTab) => void;
}) {
  const rating = session.feedback?.summary.performance_rating;
  const ratingConfig = rating ? RATING_CONFIG[rating] : null;
  const userMessages = session.messages.filter((m) => m.role === "user").length;

  return (
    <Card className="overflow-hidden min-w-0 !py-0 !gap-0">
      <CardContent className="p-0 min-w-0">
        {/* Summary row */}
        <div className="px-4 pt-3 pb-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2 flex-wrap">
                <h3 className="font-medium text-sm">{session.scenario.title}</h3>
                <span className="text-xs text-muted-foreground">
                  {session.scenario.title_ja}
                </span>
              </div>

              <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground">
                <span>{format(new Date(session.date), "MMM d, yyyy · h:mm a")}</span>
                <span>·</span>
                <span>{formatDuration(session.duration_seconds)}</span>
                <span>·</span>
                <span>{userMessages} exchange{userMessages !== 1 && "s"}</span>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {ratingConfig && (
                <Badge variant="secondary" className={`text-[10px] ${ratingConfig.class}`}>
                  {ratingConfig.label}
                </Badge>
              )}
              <span className="text-[10px] text-muted-foreground hidden sm:inline">
                {formatDistanceToNow(new Date(session.date), { addSuffix: true })}
              </span>
            </div>
          </div>

          {/* Topics + action row */}
          <div className="flex items-center justify-between gap-2 mt-1.5">
            <div className="flex flex-wrap gap-1 min-w-0 flex-1">
              {!isExpanded && session.feedback && session.feedback.summary.topics_covered.length > 0 &&
                session.feedback.summary.topics_covered.map((topic, i) => (
                  <Badge key={i} variant="outline" className="text-[10px]">
                    {topic}
                  </Badge>
                ))
              }
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={onToggle}
              className="h-7 text-xs shrink-0"
            >
              {isExpanded ? "Hide" : "Details"}
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

        {/* Expanded detail area */}
        {isExpanded && (
          <div className="border-t overflow-hidden">
            {/* Tab switcher */}
            <div className="flex border-b">
              <button
                onClick={() => onTabChange("conversation")}
                className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                  activeTab === "conversation"
                    ? "text-foreground border-b-2 border-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Conversation
              </button>
              <button
                onClick={() => onTabChange("feedback")}
                className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                  activeTab === "feedback"
                    ? "text-foreground border-b-2 border-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Feedback
                {session.feedback && session.feedback.grammar_points.length > 0 && (
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    ({session.feedback.grammar_points.length})
                  </span>
                )}
              </button>
            </div>

            {/* Tab content */}
            <div className="px-5 py-4 max-h-[28rem] overflow-y-auto overflow-x-hidden min-w-0">
              {activeTab === "conversation" ? (
                <ConversationView messages={session.messages} />
              ) : (
                <FeedbackView session={session} />
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ConversationView({ messages }: { messages: Session["messages"] }) {
  if (messages.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        No messages recorded.
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
              {format(new Date(msg.timestamp), "h:mm a")}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function FeedbackView({ session }: { session: Session }) {
  const feedback = session.feedback;

  if (!feedback) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        No feedback available for this session.
      </p>
    );
  }

  const hasGrammar = feedback.grammar_points.length > 0;
  const hasVocab = feedback.vocabulary.length > 0;
  const hasFluency = feedback.fluency_notes.length > 0;

  return (
    <div className="space-y-5">
      {/* Summary */}
      {feedback.summary.topics_covered.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
            Topics Covered
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
            Suggestion for Next Time
          </p>
          <p className="text-sm">{feedback.summary.next_session_hint}</p>
        </div>
      )}

      {/* Grammar Points */}
      {hasGrammar && (
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
            Grammar Points
          </p>
          <div className="space-y-3">
            {feedback.grammar_points.map((point, i) => (
              <div key={i} className="rounded-lg bg-muted/50 p-3 space-y-1.5">
                <div className="flex items-start gap-2">
                  <span className="text-red-500 text-sm mt-0.5 shrink-0">✗</span>
                  <p className="text-sm">{point.issue}</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-green-600 text-sm mt-0.5 shrink-0">✓</span>
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

      {/* Vocabulary */}
      {hasVocab && (
        <>
          {hasGrammar && <Separator />}
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Vocabulary ({feedback.vocabulary.length})
            </p>
            <div className="space-y-2">
              {feedback.vocabulary.map((vocab, i) => (
                <div key={i} className="rounded-lg bg-muted/50 p-3">
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
              ))}
            </div>
          </div>
        </>
      )}

      {/* Fluency Notes */}
      {hasFluency && (
        <>
          {(hasGrammar || hasVocab) && <Separator />}
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Fluency Notes
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
          No detailed feedback for this session.
        </p>
      )}
    </div>
  );
}
