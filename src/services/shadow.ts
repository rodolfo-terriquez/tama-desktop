import type { Message, ShadowAttempt, ShadowAttemptResult, ShadowScript, ShadowTurn } from "@/types";

export interface ShadowPair {
  assistant: ShadowTurn;
  user: ShadowTurn;
}

export interface ShadowComparison {
  normalizedExpected: string;
  normalizedTranscript: string;
  similarity: number;
  result: Exclude<ShadowAttemptResult, "skipped">;
}

export interface ShadowAttemptSummary {
  close: number;
  partial: number;
  off: number;
  skipped: number;
}

function hasReadableHiragana(text: string | undefined): boolean {
  return typeof text === "string" && text.trim().length > 0;
}

function hasSpeakerLabel(label: string | undefined): boolean {
  return typeof label === "string" && label.trim().length > 0;
}

const JAPANESE_PUNCTUATION_REGEX = /[\s\u3000。、！？!?,.・「」『』（）()\-[\]{}:;~〜…]/gu;

function katakanaToHiragana(text: string): string {
  return Array.from(text)
    .map((char) => {
      const code = char.charCodeAt(0);
      return code >= 0x30a1 && code <= 0x30f6
        ? String.fromCharCode(code - 0x60)
        : char;
    })
    .join("");
}

export function normalizeShadowText(text: string): string {
  return katakanaToHiragana(text)
    .replace(JAPANESE_PUNCTUATION_REGEX, "")
    .toLowerCase()
    .trim();
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array<number>(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      );
    }

    for (let j = 0; j <= b.length; j += 1) {
      previous[j] = current[j];
    }
  }

  return previous[b.length];
}

export function compareShadowAttempt(expectedText: string, transcript: string): ShadowComparison {
  const normalizedExpected = normalizeShadowText(expectedText);
  const normalizedTranscript = normalizeShadowText(transcript);

  if (!normalizedTranscript) {
    return {
      normalizedExpected,
      normalizedTranscript,
      similarity: 0,
      result: "off",
    };
  }

  const longestLength = Math.max(normalizedExpected.length, normalizedTranscript.length, 1);
  const distance = levenshteinDistance(normalizedExpected, normalizedTranscript);
  const similarity = Math.max(0, 1 - distance / longestLength);

  const result =
    similarity >= 0.84 ? "close"
    : similarity >= 0.5 ? "partial"
    : "off";

  return {
    normalizedExpected,
    normalizedTranscript,
    similarity,
    result,
  };
}

export function getShadowPairs(script: ShadowScript): ShadowPair[] {
  if (script.turns.length < 2 || script.turns.length % 2 !== 0) {
    throw new Error("Shadow script must contain an even number of alternating turns.");
  }

  const pairs: ShadowPair[] = [];

  for (let index = 0; index < script.turns.length; index += 2) {
    const assistant = script.turns[index];
    const user = script.turns[index + 1];

    if (assistant?.speaker !== "assistant" || user?.speaker !== "user") {
      throw new Error("Shadow script turns must alternate assistant and user lines.");
    }

    if (!assistant.text.trim() || !user.text.trim()) {
      throw new Error("Shadow script turns cannot be empty.");
    }

    pairs.push({ assistant, user });
  }

  return pairs;
}

export function shadowScriptHasRequiredMetadata(script: ShadowScript): boolean {
  return script.turns.every((turn) => {
    if (turn.speaker === "user" && !hasReadableHiragana(turn.reading)) {
      return false;
    }

    if (turn.speaker === "assistant" && !hasSpeakerLabel(turn.speakerLabel)) {
      return false;
    }

    return true;
  });
}

export function summarizeShadowAttempts(attempts: ShadowAttempt[]): ShadowAttemptSummary {
  return attempts.reduce<ShadowAttemptSummary>(
    (summary, attempt) => {
      summary[attempt.result] += 1;
      return summary;
    },
    { close: 0, partial: 0, off: 0, skipped: 0 }
  );
}

export function buildShadowSessionMessages(script: ShadowScript): Message[] {
  return script.turns.map((turn, index) => ({
    id: `${script.id}-${index}`,
    role: turn.speaker,
    content: turn.text,
    timestamp: new Date().toISOString(),
  }));
}
