import type { SessionFeedback } from "@/types";

export class FeedbackParseError extends Error {
  constructor(message = "Failed to parse feedback response") {
    super(message);
    this.name = "FeedbackParseError";
  }
}

function stripCodeFences(raw: string): string {
  return raw
    .replace(/```json\s*/gi, "")
    .replace(/```\s*$/g, "")
    .trim();
}

function extractJsonCandidate(raw: string): string {
  const cleaned = stripCodeFences(raw);
  const start = cleaned.indexOf("{");
  if (start < 0) return cleaned;

  const end = cleaned.lastIndexOf("}");
  if (end > start) {
    return cleaned.slice(start, end + 1);
  }

  return cleaned.slice(start);
}

function closeOpenString(text: string): string {
  let inString = false;
  let escaping = false;

  for (const char of text) {
    if (escaping) {
      escaping = false;
      continue;
    }

    if (char === "\\") {
      escaping = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
    }
  }

  return inString ? `${text}"` : text;
}

function balanceJsonClosers(text: string): string {
  let inString = false;
  let escaping = false;
  let openBraces = 0;
  let openBrackets = 0;

  for (const char of text) {
    if (escaping) {
      escaping = false;
      continue;
    }

    if (char === "\\") {
      escaping = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{") openBraces += 1;
    if (char === "}") openBraces = Math.max(0, openBraces - 1);
    if (char === "[") openBrackets += 1;
    if (char === "]") openBrackets = Math.max(0, openBrackets - 1);
  }

  return `${text}${"]".repeat(openBrackets)}${"}".repeat(openBraces)}`;
}

function attemptParse(text: string): Record<string, unknown> | null {
  const trimmed = text.trim().replace(/[,:\s]+$/g, "");
  if (!trimmed) return null;

  const repaired = balanceJsonClosers(closeOpenString(trimmed));

  try {
    return JSON.parse(repaired) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parsePossiblyTruncatedJson(raw: string): Record<string, unknown> {
  const candidate = extractJsonCandidate(raw);
  const direct = attemptParse(candidate);
  if (direct) return direct;

  const minLength = Math.max(1, candidate.length - 2000);

  for (let end = candidate.length - 1; end >= minLength; end -= 1) {
    const boundary = candidate[end - 1];
    if (boundary && !/[,\]}\n]/.test(boundary)) continue;

    const parsed = attemptParse(candidate.slice(0, end));
    if (parsed) return parsed;
  }

  throw new FeedbackParseError();
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asString(item))
    .filter((item) => item.length > 0);
}

function sanitizeVocabularyExample(value: unknown): string {
  const example = asString(value);
  if (!example) return "";

  // Remove parenthetical or quoted glosses when they contain Latin text.
  const withoutInlineTranslations = example
    .replace(/\([^)]*[A-Za-z][^)]*\)/g, "")
    .replace(/（[^）]*[A-Za-z][^）]*）/g, "")
    .replace(/"[^"]*[A-Za-z][^"]*"/g, "")
    .replace(/“[^”]*[A-Za-z][^”]*”/g, "")
    .replace(/'[^']*[A-Za-z][^']*'/g, "")
    .trim();

  // If any Latin letters remain, drop the example rather than store mixed-language text for TTS.
  if (/[A-Za-z]/.test(withoutInlineTranslations)) {
    return "";
  }

  return withoutInlineTranslations.replace(/\s{2,}/g, " ").trim();
}

export function parseFeedbackResponse(raw: string): SessionFeedback {
  const parsed = parsePossiblyTruncatedJson(raw);
  const summary =
    parsed.summary && typeof parsed.summary === "object"
      ? (parsed.summary as Record<string, unknown>)
      : {};

  const grammar_points = Array.isArray(parsed.grammar_points)
    ? parsed.grammar_points
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const record = item as Record<string, unknown>;
          const issue = asString(record.issue);
          const correction = asString(record.correction);
          const explanation = asString(record.explanation);
          if (!issue && !correction && !explanation) return null;
          return { issue, correction, explanation };
        })
        .filter((item): item is SessionFeedback["grammar_points"][number] => item !== null)
    : [];

  const vocabulary = Array.isArray(parsed.vocabulary)
    ? parsed.vocabulary
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const record = item as Record<string, unknown>;
          const word = asString(record.word);
          const meaning = asString(record.meaning);
          if (!word && !meaning) return null;
          return {
            word,
            reading: asString(record.reading),
            meaning,
            example: sanitizeVocabularyExample(record.example),
            source_session: asString(record.source_session),
          };
        })
        .filter((item): item is SessionFeedback["vocabulary"][number] => item !== null)
    : [];

  const performance_rating =
    summary.performance_rating === "needs_work" ||
    summary.performance_rating === "good" ||
    summary.performance_rating === "excellent"
      ? summary.performance_rating
      : "good";

  return {
    grammar_points,
    vocabulary,
    fluency_notes: asStringArray(parsed.fluency_notes),
    summary: {
      topics_covered: asStringArray(summary.topics_covered),
      performance_rating,
      next_session_hint: asString(summary.next_session_hint),
    },
  };
}
