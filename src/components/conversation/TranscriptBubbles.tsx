import { useEffect, useRef, useState, type ReactNode } from "react";
import { Volume2, Languages, Loader2 } from "lucide-react";
import { speak } from "@/services/tts";
import { translateToEnglish } from "@/services/claude";
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
  const containerRef = useRef<HTMLDivElement>(null);
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [showTranslation, setShowTranslation] = useState<Record<string, boolean>>({});
  const [loadingTranslation, setLoadingTranslation] = useState<Record<string, boolean>>({});
  const [playingId, setPlayingId] = useState<string | null>(null);

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
    const id = message.id;

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
      const translation = await translateToEnglish(message.content);
      setTranslations((prev) => ({ ...prev, [id]: translation }));
      setShowTranslation((prev) => ({ ...prev, [id]: true }));
    } catch (err) {
      console.error("Translation error:", err);
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
          const id = message.id;
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
                    ? "bg-blue-500 text-white rounded-br-md"
                    : "bg-gray-100 text-gray-900 rounded-bl-md dark:bg-gray-800 dark:text-gray-100"
                }`}
              >
                <div>{renderMarkdown(message.content)}</div>

                {isShowingTranslation && translation && (
                  <div className="mt-2 pt-2 border-t border-gray-300 dark:border-gray-600 text-xs text-gray-600 dark:text-gray-300">
                    {renderMarkdown(translation)}
                  </div>
                )}

                {isLoadingTranslation && (
                  <div className="mt-2 pt-2 border-t border-gray-300 dark:border-gray-600 text-xs text-gray-500 dark:text-gray-400 italic">
                    Translating...
                  </div>
                )}

                {!isUser && (
                  <div className="flex items-center justify-end mt-1.5 gap-0.5">
                    <button
                      type="button"
                      className="inline-flex items-center justify-center size-6 opacity-40 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10 rounded transition-opacity"
                      onClick={() => handleReplay(message)}
                      disabled={isPlaying}
                      title="Replay audio"
                    >
                      {isPlaying ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <Volume2 className="size-3" />
                      )}
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center justify-center size-6 opacity-40 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10 rounded transition-opacity"
                      onClick={() => handleTranslate(message)}
                      disabled={isLoadingTranslation}
                      title={isShowingTranslation ? "Hide translation" : "Translate"}
                    >
                      {isLoadingTranslation ? (
                        <Loader2 className="size-3 animate-spin" />
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
