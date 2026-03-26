import { sendMessage } from "@/services/claude";
import { saveQuiz } from "@/services/storage";
import type { Quiz } from "@/types";

const JAPANESE_CHAR_REGEX = /[\u3040-\u30ff\u3400-\u9fff]/u;

interface QuizQuestionReadingPatch {
  id: string;
  promptReading?: string;
  optionReadings?: string[];
  correctAnswerReading?: string;
  explanationReading?: string;
}

function hasJapanese(text: string | undefined): boolean {
  return typeof text === "string" && JAPANESE_CHAR_REGEX.test(text);
}

function needsReading(text: string | undefined, reading: string | undefined): boolean {
  return hasJapanese(text) && !(typeof reading === "string" && reading.trim().length > 0);
}

export function quizNeedsReadingHydration(quiz: Quiz): boolean {
  if (needsReading(quiz.title, quiz.titleReading) || needsReading(quiz.instructions, quiz.instructionsReading)) {
    return true;
  }

  return quiz.questions.some((question) => {
    if (needsReading(question.prompt, question.promptReading)) {
      return true;
    }

    if (needsReading(question.correctAnswer, question.correctAnswerReading)) {
      return true;
    }

    if (needsReading(question.explanation, question.explanationReading)) {
      return true;
    }

    return (question.options ?? []).some((option, index) =>
      needsReading(option, question.optionReadings?.[index])
    );
  });
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("No JSON returned for quiz readings.");
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return trimmed;
}

function parseLooseJsonObject(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    try {
      return JSON.parse(text.replace(/,\s*([}\]])/g, "$1")) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function getOptionalString(record: Record<string, unknown>, key: string, fallbackKey?: string): string | undefined {
  const value = record[key];
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (fallbackKey) {
    const fallbackValue = record[fallbackKey];
    if (typeof fallbackValue === "string" && fallbackValue.trim()) {
      return fallbackValue.trim();
    }
  }

  return undefined;
}

function getOptionalStringArray(record: Record<string, unknown>, key: string, fallbackKey?: string): string[] | undefined {
  const value = record[key];
  const fallbackValue = fallbackKey ? record[fallbackKey] : undefined;
  const source = Array.isArray(value) ? value : Array.isArray(fallbackValue) ? fallbackValue : undefined;

  if (!source) {
    return undefined;
  }

  const normalized = source.map((item) => typeof item === "string" ? item.trim() : "");

  return normalized.length > 0 ? normalized : undefined;
}

function parseQuizReadingsResponse(raw: string): {
  titleReading?: string;
  instructionsReading?: string;
  questions: QuizQuestionReadingPatch[];
} | null {
  const parsed = parseLooseJsonObject(extractJsonObject(raw));
  if (!parsed) {
    return null;
  }

  const rawQuestions = Array.isArray(parsed.questions) ? parsed.questions : null;
  if (!rawQuestions) {
    return null;
  }

  const questions: QuizQuestionReadingPatch[] = [];
  for (const value of rawQuestions) {
    if (!value || typeof value !== "object") {
      continue;
    }

    const record = value as Record<string, unknown>;
    const id = getOptionalString(record, "id");
    if (!id) {
      continue;
    }

    questions.push({
      id,
      promptReading: getOptionalString(record, "promptReading", "prompt_reading"),
      optionReadings: getOptionalStringArray(record, "optionReadings", "option_readings"),
      correctAnswerReading: getOptionalString(record, "correctAnswerReading", "correct_answer_reading"),
      explanationReading: getOptionalString(record, "explanationReading", "explanation_reading"),
    });
  }

  return {
    titleReading: getOptionalString(parsed, "titleReading", "title_reading"),
    instructionsReading: getOptionalString(parsed, "instructionsReading", "instructions_reading"),
    questions,
  };
}

function buildQuizReadingPrompt(): string {
  return `You add hiragana readings to an existing Japanese learning quiz for a desktop app.

Return ONLY valid JSON with no markdown fences and no extra commentary.

Output schema:
{
  "titleReading": "hiragana reading for any Japanese in the quiz title",
  "instructionsReading": "hiragana reading for any Japanese in the instructions",
  "questions": [
    {
      "id": "q1",
      "promptReading": "hiragana reading for any Japanese in the prompt",
      "optionReadings": ["hiragana reading for option 1", "hiragana reading for option 2"],
      "correctAnswerReading": "hiragana reading for any Japanese in the correct answer",
      "explanationReading": "hiragana reading for any Japanese in the explanation"
    }
  ]
}

Rules:
- Every reading value must use only hiragana.
- Match the meaning and order of the paired Japanese text exactly.
- For mixed English/Japanese strings, provide only the pronunciation of the Japanese wording.
- Omit a reading field when the paired text has no Japanese.
- Keep the questions array aligned by id with the provided quiz data.
- If an option has no Japanese, use an empty string in that position so the array length still matches.`;
}

export async function ensureQuizReadings(quiz: Quiz): Promise<Quiz> {
  if (!quizNeedsReadingHydration(quiz)) {
    return quiz;
  }

  const payload = {
    title: quiz.title,
    instructions: quiz.instructions,
    questions: quiz.questions.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      options: question.options ?? [],
      correctAnswer: question.correctAnswer,
      explanation: question.explanation,
    })),
  };

  const rawResponse = await sendMessage(
    [
      {
        id: "quiz-reading-hydration",
        role: "user",
        content: `Add hiragana readings to this quiz JSON:\n${JSON.stringify(payload)}`,
        timestamp: new Date().toISOString(),
      },
    ],
    buildQuizReadingPrompt()
  );

  const parsed = parseQuizReadingsResponse(rawResponse);
  if (!parsed) {
    throw new Error("Failed to parse quiz readings.");
  }

  const byQuestionId = new Map(parsed.questions.map((question) => [question.id, question]));
  const updated: Quiz = {
    ...quiz,
    titleReading: quiz.titleReading ?? parsed.titleReading,
    instructionsReading: quiz.instructionsReading ?? parsed.instructionsReading,
    questions: quiz.questions.map((question) => {
      const patch = byQuestionId.get(question.id);
      return {
        ...question,
        promptReading: question.promptReading ?? patch?.promptReading,
        optionReadings:
          question.optionReadings ??
          (patch?.optionReadings && patch.optionReadings.length === (question.options?.length ?? 0)
            ? patch.optionReadings
            : undefined),
        correctAnswerReading: question.correctAnswerReading ?? patch?.correctAnswerReading,
        explanationReading: question.explanationReading ?? patch?.explanationReading,
      };
    }),
  };

  if (JSON.stringify(updated) !== JSON.stringify(quiz)) {
    await saveQuiz(updated);
  }

  return updated;
}
