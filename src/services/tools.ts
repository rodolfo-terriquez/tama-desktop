import { getDueVocabulary, getUserProfile, getVocabulary, updateVocabItem } from "@/services/storage";

/**
 * Anthropic tool definitions for the conversation API.
 */
export const CONVERSATION_TOOLS = [
  {
    name: "get_due_vocabulary",
    description:
      "Get vocabulary words the student should practice. These are words from their SRS deck that are due for review. Try to naturally weave 1-2 of these words into your responses when appropriate — don't force them, but look for natural opportunities.",
    input_schema: {
      type: "object" as const,
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of words to return (default 5)",
        },
      },
    },
  },
  {
    name: "get_user_profile",
    description:
      "Get the student's profile including JLPT level, interests, topics they've practiced before, and areas they struggle with. Use this to tailor the conversation.",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
];

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

/**
 * Execute a tool call and return the result.
 */
export async function executeTool(tool: ToolCall): Promise<ToolResult> {
  let content: string;

  switch (tool.name) {
    case "get_due_vocabulary": {
      const limit = (tool.input.limit as number) || 5;
      const due = await getDueVocabulary(limit);

      if (due.length === 0) {
        content = JSON.stringify({
          message: "No vocabulary due for review right now.",
          words: [],
        });
      } else {
        content = JSON.stringify({
          message: `${due.length} word(s) due for review. Try to use some naturally in conversation.`,
          words: due.map((v) => ({
            word: v.word,
            reading: v.reading,
            meaning: v.meaning,
          })),
        });
      }
      break;
    }

    case "get_user_profile": {
      const profile = await getUserProfile();
      content = JSON.stringify({
        jlpt_level: profile.jlpt_level,
        estimated_level: profile.estimated_level,
        interests: profile.interests,
        topics_covered: profile.topics_covered,
        recent_struggles: profile.recent_struggles,
        total_sessions: profile.total_sessions,
      });
      break;
    }

    default:
      content = JSON.stringify({ error: `Unknown tool: ${tool.name}` });
  }

  return {
    type: "tool_result",
    tool_use_id: tool.id,
    content,
  };
}

/**
 * Scan an AI response for vocabulary words the student is learning.
 * Increments `times_seen_in_conversation` for any matches found.
 * Returns the list of matched word strings.
 */
export async function trackVocabularyUsage(responseText: string): Promise<string[]> {
  const vocabulary = await getVocabulary();
  if (vocabulary.length === 0) return [];

  const matched: string[] = [];

  for (const item of vocabulary) {
    if (responseText.includes(item.word)) {
      await updateVocabItem(item.id, {
        times_seen_in_conversation: item.times_seen_in_conversation + 1,
      });
      matched.push(item.word);
    }
  }

  return matched;
}
