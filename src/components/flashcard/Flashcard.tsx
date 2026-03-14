import { useCallback, useEffect, useState } from "react";
import { initializeTTS, speak, stopCurrentAudio } from "@/services/tts";
import type { VocabItem } from "@/types";

interface FlashcardProps {
  item: VocabItem;
  flipped: boolean;
  onFlipChange: (isBack: boolean) => void;
}

export function Flashcard({ item, flipped, onFlipChange }: FlashcardProps) {
  const [ttsAvailable, setTtsAvailable] = useState(false);

  const handleFlip = useCallback(() => {
    const next = !flipped;
    onFlipChange(next);
  }, [flipped, onFlipChange]);

  const playAudio = useCallback(async (text: string) => {
    if (!text) return;

    try {
      stopCurrentAudio();
      await speak(text);
    } catch (error) {
      console.error("Failed to play flashcard audio:", error);
    }
  }, []);

  const backAudioText = item.example?.trim() || item.word;
  const currentAudioText = flipped ? backAudioText : item.word;

  useEffect(() => {
    let cancelled = false;

    async function prepareAudio() {
      try {
        const result = await initializeTTS();
        if (cancelled) return;
        setTtsAvailable(result.available);
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to initialize flashcard audio:", error);
          setTtsAvailable(false);
        }
      }
    }

    prepareAudio();

    return () => {
      cancelled = true;
      stopCurrentAudio();
    };
  }, []);

  useEffect(() => {
    if (!ttsAvailable) return;
    void playAudio(currentAudioText);
  }, [currentAudioText, playAudio, ttsAvailable]);

  return (
    <div
      className="w-full max-w-sm aspect-[3/2] cursor-pointer [perspective:800px]"
      onClick={handleFlip}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          handleFlip();
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={flipped ? "Showing answer, click to show question" : "Showing question, click to show answer"}
    >
      <div
        className={`relative w-full h-full transition-transform duration-500 [transform-style:preserve-3d] ${
          flipped ? "[transform:rotateY(180deg)]" : ""
        }`}
      >
        {/* Front — Japanese word + reading */}
        <div className="absolute inset-0 flex flex-col items-center justify-center rounded-xl border bg-card p-6 shadow-sm [backface-visibility:hidden]">
          <span className="text-4xl font-bold tracking-wide">{item.word}</span>
        </div>

        {/* Back — meaning + example */}
        <div className="absolute inset-0 flex flex-col items-center justify-center rounded-xl border bg-card p-6 shadow-sm [backface-visibility:hidden] [transform:rotateY(180deg)]">
          <span className="text-2xl font-semibold text-center">{item.meaning}</span>
          {item.example && (
            <p className="mt-4 text-sm text-muted-foreground text-center italic leading-relaxed">
              {item.example}
            </p>
          )}
          <div className="mt-6 text-xs text-muted-foreground flex items-center gap-2">
            <span>{item.word}</span>
            {item.reading && item.reading !== item.word && (
              <>
                <span>·</span>
                <span>{item.reading}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
