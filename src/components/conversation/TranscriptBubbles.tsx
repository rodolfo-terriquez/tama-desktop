import { useEffect, useRef, useState, type ReactNode } from "react";
import { BrailleLoader } from "@/components/ui/braille-loader";
import { Volume2, Languages } from "lucide-react";
import { useI18n } from "@/i18n";
import { speak } from "@/services/tts";
import { translateJapaneseText } from "@/services/claude";
import type { Message } from "@/types";

function renderMarkdown(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(<strong key={match.index}>{match[1]}</strong>);
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

interface TranscriptBubblesProps {
  messages: Message[];
  visibleCount?: number;
}

export function TranscriptBubbles({
  messages,
  visibleCount = 3,
}: TranscriptBubblesProps) {
  const { locale, t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [showTranslation, setShowTranslation] = useState<Record<string, boolean>>({});
  const [loadingTranslation, setLoadingTranslation] = useState<Record<string, boolean>>({});
  const [playingId, setPlayingId] = useState<string | null>(null);
  const targetLanguage = t(locale === "es" ? "common.spanish" : "common.english");

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages]);

  const getOpacity = (index: number): number => {
    const reverseIndex = messages.length - 1 - index;
    if (reverseIndex < visibleCount) return 1;
    const fadeSteps = 3;
    const fadeIndex = reverseIndex - visibleCount;
    if (fadeIndex >= fadeSteps) return 0.15;
    return 1 - (fadeIndex / fadeSteps) * 0.7;
  };

  const handleTranslate = async (message: Message) => {
    const id = `${message.id}:${locale}`;

    if (showTranslation[id]) {
      setShowTranslation((prev) => ({ ...prev, [id]: false }));
      return;
    }
    if (translations[id]) {
      setShowTranslation((prev) => ({ ...prev, [id]: true }));
      return;
    }

    setLoadingTranslation((prev) => ({ ...prev, [id]: true }));
    try {
      const translation = await translateJapaneseText(message.content, locale);
      setTranslations((prev) => ({ ...prev, [id]: translation }));
      setShowTranslation((prev) => ({ ...prev, [id]: true }));
    } catch (err) {
      console.error("Translation error:", err);
      setTranslations((prev) => ({ ...prev, [id]: t("message.failedToTranslate") }));
      setShowTranslation((prev) => ({ ...prev, [id]: true }));
    } finally {
      setLoadingTranslation((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handleReplay = async (message: Message) => {
    setPlayingId(message.id);
    try {
      await speak(message.content);
    } catch (err) {
      console.error("Replay error:", err);
    } finally {
      setPlayingId(null);
    }
  };

  if (messages.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="w-full max-w-md mx-auto h-full overflow-y-auto scroll-smooth px-2 scrollbar-none"
      style={{
        maskImage:
          "linear-gradient(to bottom, transparent 0%, black 10%, black 100%)",
        WebkitMaskImage:
          "linear-gradient(to bottom, transparent 0%, black 10%, black 100%)",
        scrollbarWidth: "none",
        msOverflowStyle: "none",
      }}
    >
      <div className="space-y-3 py-4">
        {messages.map((message, index) => {
          const isUser = message.role === "user";
          const opacity = getOpacity(index);
          const id = `${message.id}:${locale}`;
          const isShowingTranslation = showTranslation[id];
          const isLoadingTranslation = loadingTranslation[id];
          const translation = translations[id];
          const isPlaying = playingId === id;

          return (
            <div
              key={id}
              className={`flex ${isUser ? "justify-end" : "justify-start"}`}
              style={{
                opacity,
                transition: "opacity 0.3s ease-in-out",
              }}
            >
              <div
                className={`max-w-[85%] px-4 py-2 rounded-2xl text-sm ${
                  isUser
                    ? "bg-primary text-primary-foreground rounded-br-md"
                    : "bg-secondary text-secondary-foreground rounded-bl-md border border-border/60"
                }`}
              >
                <div>{renderMarkdown(message.content)}</div>

                {isShowingTranslation && translation && (
                  <div className="mt-2 pt-2 border-t border-current/15 text-xs text-current/75">
                    {renderMarkdown(translation)}
                  </div>
                )}

                {isLoadingTranslation && (
                  <div className="mt-2 pt-2 border-t border-current/15 text-xs text-current/65 italic">
                    {t("message.translating")}
                  </div>
                )}

                {!isUser && (
                  <div className="flex items-center justify-end mt-1.5 gap-0.5">
                    <button
                      type="button"
                      className="inline-flex items-center justify-center size-6 opacity-40 hover:opacity-100 hover:bg-primary/10 rounded transition-opacity"
                      onClick={() => handleReplay(message)}
                      disabled={isPlaying}
                      title={t("message.replayAudio")}
                    >
                      {isPlaying ? (
                        <BrailleLoader className="text-[11px]" />
                      ) : (
                        <Volume2 className="size-3" />
                      )}
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center justify-center size-6 opacity-40 hover:opacity-100 hover:bg-primary/10 rounded transition-opacity"
                      onClick={() => handleTranslate(message)}
                      disabled={isLoadingTranslation}
                      title={
                        isShowingTranslation && translation
                          ? t("message.hideTranslation")
                          : t("message.translateToLanguage", { language: targetLanguage })
                      }
                    >
                      {isLoadingTranslation ? (
                        <BrailleLoader className="text-[11px]" />
                      ) : (
                        <Languages className="size-3" />
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
