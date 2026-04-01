import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { BrailleLoader } from "@/components/ui/braille-loader";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { useI18n } from "@/i18n";
import { SimpleMarkdown } from "@/lib/simple-markdown";
import {
  createSenseiThread,
  listSenseiThreads,
  loadSenseiThread,
  removeSenseiThread,
  selectSenseiThread,
  sendSenseiUserMessage,
} from "@/services/sensei";
import { cn } from "@/lib/utils";
import type { Message, SenseiThread, SenseiViewContext } from "@/types";
import { ArrowUp, Check, Copy, History, Maximize2, Minimize2, Plus, Trash2 } from "lucide-react";

interface SenseiSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentViewContext: SenseiViewContext;
  dataVersion: number;
  mode?: "sidebar" | "full";
  onExpand?: () => void;
  onMinimize?: () => void;
  onOpenQuiz?: (quizId: string) => void;
  pendingPromptRequest?: {
    id: string;
    prompt: string;
  } | null;
  onPendingPromptHandled?: (id: string) => void;
}

const frostedButtonClass =
  "border-border/80 bg-background/95 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/85";

function SenseiMessageBubble({
  message,
  mode,
  onOpenQuiz,
}: {
  message: Message;
  mode: "sidebar" | "full";
  onOpenQuiz?: (quizId: string) => void;
}) {
  const { t } = useI18n();
  const [isCopied, setIsCopied] = useState(false);
  const hasContent = message.content.trim().length > 0;
  const isAssistant = message.role === "assistant";
  const hasQuizAction = isAssistant && message.action?.type === "open_quiz";
  const quizAction = hasQuizAction ? message.action : null;

  const handleCopy = async () => {
    if (!hasContent) {
      return;
    }

    try {
      await navigator.clipboard.writeText(message.content);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = message.content;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "absolute";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }

    setIsCopied(true);
    window.setTimeout(() => setIsCopied(false), 1600);
  };

  return (
    <div className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "group relative rounded-xl px-3 py-2 text-sm leading-relaxed",
          message.role === "user"
            ? "max-w-[88%]"
            : mode === "full"
              ? "w-full"
              : "max-w-[88%]",
          message.role === "user"
            ? "bg-primary text-primary-foreground"
            : "bg-card text-card-foreground",
          isAssistant && hasContent && "pr-11",
          hasQuizAction && "space-y-3"
        )}
      >
        {isAssistant && hasContent ? (
          <button
            type="button"
            onClick={handleCopy}
            title={t("common.copy")}
            className={cn(
              "absolute top-2 right-2 inline-flex size-7 items-center justify-center rounded-md border border-border/60 bg-background/85 text-muted-foreground shadow-sm backdrop-blur transition-all",
              "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
              isCopied && "opacity-100 text-foreground"
            )}
            data-1p-ignore
          >
            {isCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            <span className="sr-only">{t("common.copy")}</span>
          </button>
        ) : null}
        {hasContent ? <SimpleMarkdown content={message.content} /> : null}
        {quizAction ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenQuiz?.(quizAction.quizId)}
            className="rounded-full"
          >
            {quizAction.label}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function SenseiConversation({
  thread,
  threads,
  isLoading,
  error,
  historyOpen,
  mode,
  onExpand,
  onMinimize,
  onCreateNewChat,
  onToggleHistory,
  onDeleteThread,
  onSelectThread,
  onSend,
  onOpenQuiz,
}: {
  thread: SenseiThread | null;
  threads: SenseiThread[];
  isLoading: boolean;
  error: string | null;
  historyOpen: boolean;
  mode: "sidebar" | "full";
  onExpand?: () => void;
  onMinimize?: () => void;
  onCreateNewChat: () => Promise<void>;
  onToggleHistory: () => void;
  onDeleteThread: (threadId: string) => Promise<void>;
  onSelectThread: (threadId: string) => Promise<void>;
  onSend: (text: string) => Promise<void>;
  onOpenQuiz?: (quizId: string) => void;
}) {
  const { t } = useI18n();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread?.messages, isLoading]);

  const formatThreadTitle = (value: SenseiThread): string => {
    const firstUserMessage = value.messages.find((message) => message.role === "user");
    if (!firstUserMessage) {
      return t("sensei.newChatLabel");
    }

    return firstUserMessage.content.length > 42
      ? `${firstUserMessage.content.slice(0, 42)}...`
      : firstUserMessage.content;
  };

  const formatThreadMeta = (value: SenseiThread): string => {
    return new Date(value.lastActiveAt).toLocaleString();
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="absolute top-0 left-0 right-0 z-10 px-3 py-3">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={mode === "full" ? onMinimize : onExpand}
            title={mode === "full" ? t("sensei.minimizeChat") : t("sensei.expandChat")}
            className={cn("h-8 rounded-full px-2.5", frostedButtonClass)}
          >
            {mode === "full" ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            <span className="sr-only">
              {mode === "full" ? t("sensei.minimizeChat") : t("sensei.expandChat")}
            </span>
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void onCreateNewChat()}
            title={t("sensei.newChat")}
            className={cn("h-8 rounded-full px-2.5", frostedButtonClass)}
          >
            <Plus className="size-4" />
            <span className="sr-only">{t("sensei.newChat")}</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onToggleHistory}
            title={t("sensei.history")}
            className={cn(
              "ml-auto h-8 rounded-full px-2.5",
              frostedButtonClass,
              historyOpen && "bg-accent/90 text-accent-foreground supports-[backdrop-filter]:bg-accent/80"
            )}
          >
            <History className="size-4" />
            <span className="sr-only">{t("sensei.history")}</span>
          </Button>
        </div>
      </div>
      {historyOpen && (
        <div className="absolute top-14 left-3 right-3 z-20 overflow-hidden rounded-2xl border border-border bg-popover shadow-lg">
          <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
            {t("sensei.history")}
          </div>
          {threads.length > 0 ? (
            <ScrollArea className="max-h-72">
              <div className="p-2">
                {threads.map((item) => (
                  <div
                    key={item.id}
                    className={cn(
                      "flex items-start gap-2 rounded-xl px-2 py-1.5 transition-colors",
                      item.id === thread?.id ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => void onSelectThread(item.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate text-sm font-medium">{formatThreadTitle(item)}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {formatThreadMeta(item)}
                      </span>
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => void onDeleteThread(item.id)}
                      title={t("sensei.deleteChat")}
                      className="mt-0.5 size-7 shrink-0 rounded-full text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                      <span className="sr-only">{t("sensei.deleteChat")}</span>
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          ) : (
            <p className="px-3 py-4 text-sm text-muted-foreground">{t("sensei.noHistory")}</p>
          )}
        </div>
      )}
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 px-4 pt-14 pb-28">
          {thread && thread.messages.length > 0 ? (
            thread.messages.map((message) => (
              <SenseiMessageBubble
                key={message.id}
                message={message}
                mode={mode}
                onOpenQuiz={onOpenQuiz}
              />
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">{t("sensei.openChat")}</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>{t("sensei.emptySuggestionFeedback")}</li>
                <li>{t("sensei.emptySuggestionScenario")}</li>
                <li>{t("sensei.emptySuggestionFlashcards")}</li>
              </ul>
            </div>
          )}

          {isLoading && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2 text-sm text-muted-foreground">
                <BrailleLoader className="text-[13px]" />
                <span>{t("sensei.thinking")}</span>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      <form
        className="absolute inset-x-3 bottom-3 z-20"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.target as HTMLFormElement;
          const input = form.elements.namedItem("senseiInput") as HTMLInputElement;
          const value = input.value.trim();
          if (!value || isLoading) return;
          void onSend(value);
          input.value = "";
        }}
      >
        <div className="relative">
          <Input
            name="senseiInput"
            placeholder={t("sensei.placeholder")}
            disabled={isLoading}
            className={cn(
              "h-12 rounded-2xl border-border/80 bg-background/95 pr-14 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/85",
              mode === "sidebar" && "bg-card/95 supports-[backdrop-filter]:bg-card/85"
            )}
          />
          <Button
            type="submit"
            size="icon"
            disabled={isLoading}
            title={t("sensei.send")}
            className={cn(
              "absolute top-1/2 right-1.5 size-9 -translate-y-1/2 rounded-full border border-border/80 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-primary/85"
            )}
          >
            <ArrowUp className="size-4" />
          </Button>
        </div>
      </form>
    </div>
  );
}

export function SenseiSidebar({
  open,
  onOpenChange,
  currentViewContext,
  dataVersion,
  mode = "sidebar",
  onExpand,
  onMinimize,
  onOpenQuiz,
  pendingPromptRequest,
  onPendingPromptHandled,
}: SenseiSidebarProps) {
  const isMobile = useIsMobile();
  const [thread, setThread] = useState<SenseiThread | null>(null);
  const [threads, setThreads] = useState<SenseiThread[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const lastAutoPromptIdRef = useRef<string | null>(null);

  const upsertThread = useCallback((nextThread: SenseiThread) => {
    setThread(nextThread);
    setThreads((prev) => {
      const remaining = prev.filter((item) => item.id !== nextThread.id);
      return [nextThread, ...remaining].sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
    });
  }, []);

  const refreshThreads = useCallback(async () => {
    const [activeThread, availableThreads] = await Promise.all([
      loadSenseiThread(),
      listSenseiThreads(),
    ]);
    setThread(activeThread);
    setThreads(availableThreads);
  }, []);

  useEffect(() => {
    let cancelled = false;
    refreshThreads()
      .then(() => {
        if (!cancelled) {
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load Sensei");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [dataVersion, refreshThreads]);

  const handleSend = async (text: string) => {
    setError(null);
    setIsLoading(true);
    setHistoryOpen(false);

    try {
      const updated = await sendSenseiUserMessage(text, currentViewContext, {
        onUserMessageSaved: upsertThread,
      });
      upsertThread(updated);
      setThreads(await listSenseiThreads());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateNewChat = async () => {
    try {
      setError(null);
      const created = await createSenseiThread();
      setThread(created);
      setThreads(await listSenseiThreads());
      setHistoryOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create a new Sensei chat");
    }
  };

  const handleSelectThread = async (threadId: string) => {
    try {
      setError(null);
      const selected = await selectSenseiThread(threadId);
      setThread(selected);
      setThreads(await listSenseiThreads());
      setHistoryOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Sensei chat history");
    }
  };

  const handleDeleteThread = async (threadId: string) => {
    try {
      setError(null);
      const replacement = await removeSenseiThread(threadId);
      setThread(replacement);
      setThreads(await listSenseiThreads());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete Sensei chat");
    }
  };

  useEffect(() => {
    if (!open || !pendingPromptRequest || isLoading) {
      return;
    }

    if (lastAutoPromptIdRef.current === pendingPromptRequest.id) {
      return;
    }

    lastAutoPromptIdRef.current = pendingPromptRequest.id;
    onPendingPromptHandled?.(pendingPromptRequest.id);
    void handleSend(pendingPromptRequest.prompt);
  }, [isLoading, onPendingPromptHandled, open, pendingPromptRequest]);

  if (mode === "full") {
    return (
      <div className="flex h-full min-h-0 flex-1 bg-background">
        <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1">
          <SenseiConversation
            thread={thread}
            threads={threads}
            isLoading={isLoading}
            error={error}
            historyOpen={historyOpen}
            mode={mode}
            onExpand={onExpand}
            onMinimize={onMinimize}
            onCreateNewChat={handleCreateNewChat}
            onToggleHistory={() => setHistoryOpen((value) => !value)}
            onDeleteThread={handleDeleteThread}
            onSelectThread={handleSelectThread}
            onSend={handleSend}
            onOpenQuiz={onOpenQuiz}
          />
        </div>
      </div>
    );
  }

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="left" className="w-full p-0 sm:max-w-md">
          <SheetHeader className="sr-only">
            <SheetTitle>Sensei</SheetTitle>
            <SheetDescription>Persistent Tama teacher chat</SheetDescription>
          </SheetHeader>
          <div className="flex h-full min-h-0 flex-col">
          <SenseiConversation
            thread={thread}
            threads={threads}
            isLoading={isLoading}
            error={error}
            historyOpen={historyOpen}
            mode={mode}
            onExpand={onExpand}
            onMinimize={onMinimize}
            onCreateNewChat={handleCreateNewChat}
            onToggleHistory={() => setHistoryOpen((value) => !value)}
            onDeleteThread={handleDeleteThread}
            onSelectThread={handleSelectThread}
            onSend={handleSend}
            onOpenQuiz={onOpenQuiz}
          />
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  if (!open) return null;

  return (
    <aside className="hidden h-full min-h-0 w-[24rem] shrink-0 border-r bg-card md:flex md:flex-col">
      <SenseiConversation
        thread={thread}
        threads={threads}
        isLoading={isLoading}
        error={error}
        historyOpen={historyOpen}
        mode={mode}
        onExpand={onExpand}
        onMinimize={onMinimize}
        onCreateNewChat={handleCreateNewChat}
        onToggleHistory={() => setHistoryOpen((value) => !value)}
        onDeleteThread={handleDeleteThread}
        onSelectThread={handleSelectThread}
        onSend={handleSend}
        onOpenQuiz={onOpenQuiz}
      />
    </aside>
  );
}
