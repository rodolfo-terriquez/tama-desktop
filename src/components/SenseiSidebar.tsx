import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
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
import { renderSimpleMarkdown } from "@/lib/simple-markdown";
import {
  createSenseiThread,
  listSenseiThreads,
  loadSenseiThread,
  removeSenseiThread,
  selectSenseiThread,
  sendSenseiUserMessage,
} from "@/services/sensei";
import { cn } from "@/lib/utils";
import type { SenseiThread, SenseiViewContext } from "@/types";
import { ArrowLeft, ArrowUp, History, Loader2, Plus, Trash2 } from "lucide-react";

interface SenseiSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentViewContext: SenseiViewContext;
  dataVersion: number;
}

function SenseiConversation({
  thread,
  threads,
  isLoading,
  error,
  historyOpen,
  onClose,
  onCreateNewChat,
  onToggleHistory,
  onDeleteThread,
  onSelectThread,
  onSend,
}: {
  thread: SenseiThread | null;
  threads: SenseiThread[];
  isLoading: boolean;
  error: string | null;
  historyOpen: boolean;
  onClose: () => void;
  onCreateNewChat: () => Promise<void>;
  onToggleHistory: () => void;
  onDeleteThread: (threadId: string) => Promise<void>;
  onSelectThread: (threadId: string) => Promise<void>;
  onSend: (text: string) => Promise<void>;
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
      <div className="absolute top-3 left-3 right-3 z-10 flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          title={t("sensei.closeChat")}
          className="h-8 rounded-full px-2.5"
        >
          <ArrowLeft className="size-4" />
          <span className="sr-only">{t("sensei.closeChat")}</span>
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => void onCreateNewChat()}
          title={t("sensei.newChat")}
          className="h-8 rounded-full px-2.5"
        >
          <Plus className="size-4" />
          <span className="sr-only">{t("sensei.newChat")}</span>
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onToggleHistory}
          title={t("sensei.history")}
          className={cn("ml-auto h-8 rounded-full px-2.5", historyOpen && "bg-accent text-accent-foreground")}
        >
          <History className="size-4" />
          <span className="sr-only">{t("sensei.history")}</span>
        </Button>
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
        <div className="space-y-3 px-4 pt-14 pb-4">
          {thread && thread.messages.length > 0 ? (
            thread.messages.map((message) => (
              <div key={message.id} className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[88%] rounded-xl px-3 py-2 text-sm leading-relaxed",
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-card text-card-foreground"
                  )}
                >
                  <p className="whitespace-pre-wrap">{renderSimpleMarkdown(message.content)}</p>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">{t("sensei.emptyTitle")}</p>
              <p className="mt-1">{t("sensei.emptyDescription")}</p>
            </div>
          )}

          {isLoading && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
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
        className="shrink-0 px-3 pb-3"
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
            className="h-12 rounded-2xl border-border/70 bg-background pr-14"
          />
          <Button
            type="submit"
            size="icon"
            disabled={isLoading}
            title={t("sensei.send")}
            className="absolute top-1/2 right-1.5 size-9 -translate-y-1/2 rounded-full"
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
}: SenseiSidebarProps) {
  const isMobile = useIsMobile();
  const [thread, setThread] = useState<SenseiThread | null>(null);
  const [threads, setThreads] = useState<SenseiThread[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

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

    try {
      const updated = await sendSenseiUserMessage(text, currentViewContext);
      setThread(updated);
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
            onClose={() => onOpenChange(false)}
            onCreateNewChat={handleCreateNewChat}
            onToggleHistory={() => setHistoryOpen((value) => !value)}
            onDeleteThread={handleDeleteThread}
            onSelectThread={handleSelectThread}
            onSend={handleSend}
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
        onClose={() => onOpenChange(false)}
        onCreateNewChat={handleCreateNewChat}
        onToggleHistory={() => setHistoryOpen((value) => !value)}
        onDeleteThread={handleDeleteThread}
        onSelectThread={handleSelectThread}
        onSend={handleSend}
      />
    </aside>
  );
}
