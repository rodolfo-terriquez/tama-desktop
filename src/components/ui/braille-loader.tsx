import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

function toBraille(bits: number): string {
  return String.fromCodePoint(0x2800 + bits);
}

const BRAILLE_CLOCKWISE_LOOP = [1, 8, 16, 32, 4, 2] as const;

const BRAILLE_FRAMES = (() => {
  const frames: string[] = [];

  for (let start = 0; start < BRAILLE_CLOCKWISE_LOOP.length; start += 1) {
    let bits = 0;

    for (let offset = 0; offset < 3; offset += 1) {
      bits |= BRAILLE_CLOCKWISE_LOOP[(start + offset) % BRAILLE_CLOCKWISE_LOOP.length];
    }

    frames.push(toBraille(bits));
  }

  return frames;
})();

interface BrailleLoaderProps {
  className?: string;
}

export function BrailleLoader({ className }: BrailleLoaderProps) {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setFrameIndex((current) => (current + 1) % BRAILLE_FRAMES.length);
    }, 90);

    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex items-center justify-center font-mono leading-none select-none",
        className
      )}
    >
      {BRAILLE_FRAMES[frameIndex]}
    </span>
  );
}
