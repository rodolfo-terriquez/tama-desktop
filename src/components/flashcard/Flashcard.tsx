import { useState, useCallback } from "react";
import type { VocabItem } from "@/types";

interface FlashcardProps {
  item: VocabItem;
  onFlip?: (isBack: boolean) => void;
}

export function Flashcard({ item, onFlip }: FlashcardProps) {
  const [flipped, setFlipped] = useState(false);

  const handleFlip = useCallback(() => {
    const next = !flipped;
    setFlipped(next);
    onFlip?.(next);
  }, [flipped, onFlip]);

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
    setRevealed(isBack);
  }, []);
  return { revealed, handleFlip };
}
