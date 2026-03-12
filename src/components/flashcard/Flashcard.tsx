import { useState, useCallback, useEffect, type KeyboardEvent, type MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { initializeTTS, speak, stopCurrentAudio } from "@/services/tts";
import type { VocabItem } from "@/types";
import { Volume2 } from "lucide-react";

interface FlashcardProps {
  item: VocabItem;
  onFlip?: (isBack: boolean) => void;
}

export function Flashcard({ item, onFlip }: FlashcardProps) {
  const [flipped, setFlipped] = useState(false);
  const [ttsAvailable, setTtsAvailable] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);

  const handleFlip = useCallback(() => {
    const next = !flipped;
    setFlipped(next);
    onFlip?.(next);
  }, [flipped, onFlip]);

  const playAudio = useCallback(async (text: string) => {
    if (!text) return;

    setIsPlayingAudio(true);
    try {
      stopCurrentAudio();
      await speak(text);
    } catch (error) {
      console.error("Failed to play flashcard audio:", error);
    } finally {
      setIsPlayingAudio(false);
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

  const handleReplayClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      void playAudio(currentAudioText);
    },
    [currentAudioText, playAudio]
  );

  const handleReplayKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  }, []);

  return (
    <div
      className="w-full max-w-sm aspect-[3/2] cursor-pointer [perspective:800px]"
      onClick={handleFlip}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
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
          {ttsAvailable && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="absolute top-3 right-3 size-9 rounded-full bg-background/90"
              onClick={handleReplayClick}
              onKeyDown={handleReplayKeyDown}
              aria-label={isPlayingAudio ? "Playing audio" : "Replay audio"}
              disabled={isPlayingAudio}
            >
              <Volume2 className="size-4" />
            </Button>
          )}
          <span className="text-4xl font-bold tracking-wide">{item.word}</span>
          {item.reading && item.reading !== item.word && (
            <span className="mt-2 text-lg text-muted-foreground">
              {item.reading}
            </span>
          )}
          <span className="mt-6 text-xs text-muted-foreground">
            Tap to reveal
          </span>
        </div>

        {/* Back — meaning + example */}
        <div className="absolute inset-0 flex flex-col items-center justify-center rounded-xl border bg-card p-6 shadow-sm [backface-visibility:hidden] [transform:rotateY(180deg)]">
          {ttsAvailable && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="absolute top-3 right-3 size-9 rounded-full bg-background/90"
              onClick={handleReplayClick}
              onKeyDown={handleReplayKeyDown}
              aria-label={isPlayingAudio ? "Playing audio" : "Replay audio"}
              disabled={isPlayingAudio}
            >
              <Volume2 className="size-4" />
            </Button>
          )}
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

/**
 * Reset the flip state when the card changes.
 * Use this key prop pattern: <Flashcard key={item.id} item={item} />
 */
export function useFlashcardReset() {
  const [revealed, setRevealed] = useState(false);
  const handleFlip = useCallback((isBack: boolean) => {
    if (isBack) {
      setRevealed(true);
    }
  }, []);
  return { revealed, handleFlip };
}
