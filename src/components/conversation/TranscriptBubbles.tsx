import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Message } from "@/types";
import { translateToEnglish } from "@/services/claude";

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
  /** Number of recent messages to show with full opacity */
  visibleCount?: number;
}

export function TranscriptBubbles({
  messages,
  visibleCount = 3,
}: TranscriptBubblesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Store translations keyed by message ID
  const [translations, setTranslations] = useState<Record<string, string>>({});
  // Track which messages are showing translation
  const [showTranslation, setShowTranslation] = useState<Record<string, boolean>>({});
  // Track which messages are currently loading translation
  const [loadingTranslation, setLoadingTranslation] = useState<Record<string, boolean>>({});

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages]);

  // Calculate opacity for each message based on position
  const getOpacity = (index: number): number => {
    const reverseIndex = messages.length - 1 - index;
    if (reverseIndex < visibleCount) {
      return 1;
    }
    // Fade out older messages
    const fadeSteps = 3;
    const fadeIndex = reverseIndex - visibleCount;
    if (fadeIndex >= fadeSteps) {
      return 0.15;
    }
    return 1 - (fadeIndex / fadeSteps) * 0.7;
  };

  // Handle clicking on a bubble to translate
  const handleBubbleClick = async (message: Message) => {
    // Only translate AI messages (user already knows what they said)
    if (message.role === "user") return;

    const messageId = message.id;

    // If already showing translation, toggle it off
    if (showTranslation[messageId]) {
      setShowTranslation((prev) => ({ ...prev, [messageId]: false }));
      return;
    }

    // If we already have the translation, just show it
    if (translations[messageId]) {
      setShowTranslation((prev) => ({ ...prev, [messageId]: true }));
      return;
    }

    // Fetch translation
    setLoadingTranslation((prev) => ({ ...prev, [messageId]: true }));
    try {
      const translation = await translateToEnglish(message.content);
      setTranslations((prev) => ({ ...prev, [messageId]: translation }));
      setShowTranslation((prev) => ({ ...prev, [messageId]: true }));
    } catch (err) {
      console.error("Translation error:", err);
    } finally {
      setLoadingTranslation((prev) => ({ ...prev, [messageId]: false }));
    }
  };

  if (messages.length === 0) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className="w-full max-w-md mx-auto max-h-48 overflow-y-auto scroll-smooth px-2 scrollbar-none"
      style={{
        maskImage:
          "linear-gradient(to bottom, transparent 0%, black 15%, black 100%)",
        WebkitMaskImage:
          "linear-gradient(to bottom, transparent 0%, black 15%, black 100%)",
        scrollbarWidth: "none", // Firefox
        msOverflowStyle: "none", // IE/Edge
      }}
    >
      <div className="space-y-3 py-4">
        {messages.map((message, index) => {
          const isUser = message.role === "user";
          const opacity = getOpacity(index);
          const messageId = message.id;
          const isShowingTranslation = showTranslation[messageId];
          const isLoading = loadingTranslation[messageId];
          const translation = translations[messageId];

          return (
            <div
              key={messageId}
              className={`flex ${isUser ? "justify-end" : "justify-start"}`}
              style={{
                opacity,
                transition: "opacity 0.3s ease-in-out",
              }}
            >
              <div
                onClick={() => handleBubbleClick(message)}
                className={`max-w-[85%] px-4 py-2 rounded-2xl text-sm ${
                  isUser
                    ? "bg-blue-500 text-white rounded-br-md"
                    : "bg-gray-100 text-gray-900 rounded-bl-md dark:bg-gray-800 dark:text-gray-100 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                }`}
              >
                <div>{renderMarkdown(message.content)}</div>

                {/* Loading indicator */}
                {isLoading && (
                  <div className="mt-2 pt-2 border-t border-gray-300 dark:border-gray-600 text-xs text-gray-500 dark:text-gray-400 italic">
                    Translating...
                  </div>
                )}

                {/* Translation */}
                {isShowingTranslation && translation && (
                  <div className="mt-2 pt-2 border-t border-gray-300 dark:border-gray-600 text-xs text-gray-600 dark:text-gray-300">
                    {renderMarkdown(translation)}
                  </div>
                )}

                {/* Hint for AI messages */}
                {!isUser && !isShowingTranslation && !isLoading && (
                  <div className="mt-1 text-[10px] text-gray-400 dark:text-gray-500">
                    Tap to translate
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
