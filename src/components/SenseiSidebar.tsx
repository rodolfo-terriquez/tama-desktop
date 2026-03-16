import { useEffect, useRef, useState } from "react";
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
import { loadSenseiThread, sendSenseiUserMessage } from "@/services/sensei";
import { cn } from "@/lib/utils";
import type { SenseiThread, SenseiViewContext } from "@/types";
import { ArrowLeft, ArrowUp, Loader2 } from "lucide-react";

interface SenseiSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentViewContext: SenseiViewContext;
  dataVersion: number;
}

function SenseiConversation({
  thread,
  isLoading,
  error,
  onClose,
  onSend,
}: {
  thread: SenseiThread | null;
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
  onSend: (text: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread?.messages, isLoading]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <Button
        type="button"
        variant="outline"
        onClick={onClose}
        title={t("sensei.closeChat")}
        className="absolute top-3 left-3 z-10 h-8 rounded-full px-2.5"
      >
        <ArrowLeft className="size-4" />
        <span className="sr-only">{t("sensei.closeChat")}</span>
      </Button>
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
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadSenseiThread()
      .then((loaded) => {
        if (!cancelled) {
          setThread(loaded);
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
  }, [dataVersion]);

  const handleSend = async (text: string) => {
    setError(null);
    setIsLoading(true);

    try {
      const updated = await sendSenseiUserMessage(text, currentViewContext);
      setThread(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setIsLoading(false);
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
            isLoading={isLoading}
            error={error}
            onClose={() => onOpenChange(false)}
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
        isLoading={isLoading}
        error={error}
        onClose={() => onOpenChange(false)}
        onSend={handleSend}
      />
    </aside>
  );
}
