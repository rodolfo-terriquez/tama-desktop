import { useState } from "react";
import { translateJapaneseText } from "@/services/claude";
import { SimpleMarkdown } from "@/lib/simple-markdown";
import { speak } from "@/services/tts";
import { BrailleLoader } from "@/components/ui/braille-loader";
import { Check, Copy, Languages, Volume2 } from "lucide-react";
import { useI18n } from "@/i18n";
import type { AppLocale } from "@/types";
import type { Message } from "@/types";

interface MessageBubbleProps {
  message: Message;
  isSpeaking?: boolean;
  layout?: "default" | "sensei-like";
}

export function MessageBubble({
  message,
  isSpeaking: externalSpeaking,
  layout = "default",
}: MessageBubbleProps) {
  const { locale, t } = useI18n();
  const [translations, setTranslations] = useState<Partial<Record<AppLocale, string>>>({});
  const [isTranslating, setIsTranslating] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const showGlow = isAssistant && (isPlaying || externalSpeaking);
  const translation = translations[locale];
  const targetLanguage = t(locale === "es" ? "common.spanish" : "common.english");
  const isSenseiLike = layout === "sensei-like";

  const handleTranslate = async () => {
    if (translation) {
      setShowTranslation(!showTranslation);
      return;
    }

    setIsTranslating(true);
    try {
      const result = await translateJapaneseText(message.content, locale);
      setTranslations((prev) => ({ ...prev, [locale]: result }));
      setShowTranslation(true);
    } catch (err) {
      console.error("Translation error:", err);
      setTranslations((prev) => ({ ...prev, [locale]: t("message.failedToTranslate") }));
      setShowTranslation(true);
    } finally {
      setIsTranslating(false);
    }
  };

  const handleReplay = async () => {
    setIsPlaying(true);
    try {
      await speak(message.content);
    } catch (err) {
      console.error("Replay error:", err);
    } finally {
      setIsPlaying(false);
    }
  };

  const handleCopy = async () => {
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
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`relative ${
          isUser
            ? "max-w-[88%]"
            : isSenseiLike
              ? "w-full"
              : "max-w-[80%]"
        } ${showGlow ? "speaking-glow" : ""}`}
      >
        {showGlow && (
          <div
            className="absolute -inset-[2px] rounded-xl opacity-75 blur-[3px] animate-gradient-rotate"
            style={{
              background:
                "conic-gradient(from var(--gradient-angle, 0deg), var(--info), var(--primary), var(--review-again), var(--info))",
            }}
          />
        )}
        <div
          className={`relative rounded-xl px-4 py-2 ${
            isUser ? "bg-primary text-primary-foreground" : "bg-muted"
          }`}
        >
          <SimpleMarkdown content={message.content} className={isSenseiLike ? "text-sm" : "text-lg"} />

          {isAssistant && (
            <>
              {showTranslation && translation && (
                <div className="mt-2 border-t border-current/20 pt-2 text-sm opacity-80 italic">
                  <SimpleMarkdown content={translation} />
                </div>
              )}
              <div className="flex items-center justify-end mt-2">
                <div className="flex gap-1">
                  <button
                    type="button"
                    className="hover:bg-foreground/5 inline-flex size-7 items-center justify-center rounded opacity-60 transition-opacity hover:opacity-100"
                    onClick={handleReplay}
                    disabled={isPlaying}
                    title={t("message.replayAudio")}
                    data-1p-ignore
                  >
                    {isPlaying ? (
                      <BrailleLoader className="text-[13px]" />
                    ) : (
                      <Volume2 className="size-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    className="hover:bg-foreground/5 inline-flex size-7 items-center justify-center rounded opacity-60 transition-opacity hover:opacity-100"
                    onClick={handleTranslate}
                    disabled={isTranslating}
                    title={
                      showTranslation && translation
                        ? t("message.showJapanese")
                        : t("message.translateToLanguage", { language: targetLanguage })
                    }
                    data-1p-ignore
                  >
                    {isTranslating ? (
                      <BrailleLoader className="text-[13px]" />
                    ) : (
                      <Languages className="size-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    className="hover:bg-foreground/5 inline-flex size-7 items-center justify-center rounded opacity-60 transition-opacity hover:opacity-100"
                    onClick={handleCopy}
                    title={t("common.copy")}
                    data-1p-ignore
                  >
                    {isCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    <span className="sr-only">{t("common.copy")}</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
