import { emitDataChanged } from "@/services/app-events";
import {
  addCustomScenario,
  addVocabItem,
  createOngoingChat,
  getCustomScenarios,
  getDueVocabulary,
  getOngoingChats,
  getUserProfile,
  getVocabulary,
  updateVocabItem,
} from "@/services/storage";

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Anthropic tool definitions for the conversation API.
 */
export const CONVERSATION_TOOLS: ToolDefinition[] = [
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

export const SENSEI_TOOLS: ToolDefinition[] = [
  {
    name: "create_custom_scenario",
    description:
      "Create and save a new custom conversation scenario in the app when the student explicitly asks for one.",
    input_schema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Scenario title in the student's language",
        },
        title_ja: {
          type: "string",
          description: "Optional Japanese title if useful for the scenario",
        },
        description: {
          type: "string",
          description: "Short scenario summary shown in the scenario list",
        },
        setting: {
          type: "string",
          description: "Where the conversation takes place and why",
        },
        character_role: {
          type: "string",
          description: "Who the AI will role-play as",
        },
        objectives: {
          type: "array",
          description: "1-5 concrete speaking goals for the student",
          items: { type: "string" },
        },
        custom_prompt: {
          type: "string",
          description: "Optional extra structure or constraints for the conversation",
        },
      },
      required: ["title", "description", "setting", "character_role", "objectives"],
    },
  },
  {
    name: "create_ongoing_chat_persona",
    description:
      "Create and save a new ongoing chat persona when the student asks for a new persistent friend or persona.",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Display name of the persona",
        },
        persona: {
          type: "string",
          description: "Short description of the persona's personality and background",
        },
      },
      required: ["name", "persona"],
    },
  },
  {
    name: "create_flashcard",
    description:
      "Create and save a flashcard in the student's SRS deck when the student explicitly asks to add a word.",
    input_schema: {
      type: "object",
      properties: {
        word: {
          type: "string",
          description: "Japanese vocabulary word or expression",
        },
        reading: {
          type: "string",
          description: "Reading in kana",
        },
        meaning: {
          type: "string",
          description: "Meaning in the student's preferred explanation language",
        },
        example: {
          type: "string",
          description: "Short natural Japanese example sentence using the word",
        },
        source_session: {
          type: "string",
          description: "Optional source label or YYYY-MM-DD date; defaults to today",
        },
      },
      required: ["word", "reading", "meaning", "example"],
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
        name: profile.name ?? null,
        age: profile.age ?? null,
        about_you: profile.aboutYou ?? null,
        estimated_level: profile.estimated_level,
        interests: profile.interests,
        topics_covered: profile.topics_covered,
        recent_struggles: profile.recent_struggles,
        total_sessions: profile.total_sessions,
      });
      break;
    }

    case "create_custom_scenario": {
      const title = String(tool.input.title ?? "").trim();
      const description = String(tool.input.description ?? "").trim();
      const setting = String(tool.input.setting ?? "").trim();
      const characterRole = String(tool.input.character_role ?? "").trim();
      const titleJa = String(tool.input.title_ja ?? "").trim();
      const customPrompt = String(tool.input.custom_prompt ?? "").trim();
      const objectives = Array.isArray(tool.input.objectives)
        ? tool.input.objectives.map((value) => String(value).trim()).filter(Boolean)
        : [];

      if (!title || !description || !setting || !characterRole || objectives.length === 0) {
        content = JSON.stringify({
          success: false,
          error: "Missing required scenario fields.",
        });
        break;
      }

      const existing = await getCustomScenarios();
      const duplicate = existing.find(
        (scenario) =>
          scenario.title.trim().toLowerCase() === title.toLowerCase() ||
          (titleJa && scenario.title_ja.trim() === titleJa)
      );

      if (duplicate) {
        content = JSON.stringify({
          success: true,
          action: "duplicate",
          scenario: {
            id: duplicate.id,
            title: duplicate.title,
            title_ja: duplicate.title_ja,
          },
          message: "A matching custom scenario already exists.",
        });
        break;
      }

      const scenario = await addCustomScenario({
        title,
        title_ja: titleJa,
        description,
        setting,
        character_role: characterRole,
        objectives,
        custom_prompt: customPrompt || undefined,
      });
      emitDataChanged("sensei-write");
      content = JSON.stringify({
        success: true,
        action: "created",
        scenario: {
          id: scenario.id,
          title: scenario.title,
          title_ja: scenario.title_ja,
        },
        message: "Custom scenario created.",
      });
      break;
    }

    case "create_ongoing_chat_persona": {
      const name = String(tool.input.name ?? "").trim();
      const persona = String(tool.input.persona ?? "").trim();

      if (!name || !persona) {
        content = JSON.stringify({
          success: false,
          error: "Missing required persona fields.",
        });
        break;
      }

      const existing = await getOngoingChats();
      const duplicate = existing.find((chat) => chat.name.trim().toLowerCase() === name.toLowerCase());
      if (duplicate) {
        content = JSON.stringify({
          success: true,
          action: "duplicate",
          chat: {
            id: duplicate.id,
            name: duplicate.name,
          },
          message: "A persona with that name already exists.",
        });
        break;
      }

      const chat = await createOngoingChat(name, persona);
      emitDataChanged("sensei-write");
      content = JSON.stringify({
        success: true,
        action: "created",
        chat: {
          id: chat.id,
          name: chat.name,
        },
        message: "Ongoing chat persona created.",
      });
      break;
    }

    case "create_flashcard": {
      const word = String(tool.input.word ?? "").trim();
      const reading = String(tool.input.reading ?? "").trim();
      const meaning = String(tool.input.meaning ?? "").trim();
      const example = String(tool.input.example ?? "").trim();
      const sourceSession =
        String(tool.input.source_session ?? "").trim() || new Date().toISOString().split("T")[0];

      if (!word || !reading || !meaning || !example) {
        content = JSON.stringify({
          success: false,
          error: "Missing required flashcard fields.",
        });
        break;
      }

      const existing = await getVocabulary();
      const duplicate = existing.find(
        (item) => item.word === word && item.meaning === meaning
      );
      if (duplicate) {
        content = JSON.stringify({
          success: true,
          action: "duplicate",
          flashcard: {
            id: duplicate.id,
            word: duplicate.word,
            meaning: duplicate.meaning,
          },
          message: "That flashcard already exists.",
        });
        break;
      }

      const card = await addVocabItem({
        word,
        reading,
        meaning,
        example,
        source_session: sourceSession,
      });
      emitDataChanged("sensei-write");
      content = JSON.stringify({
        success: true,
        action: "created",
        flashcard: {
          id: card.id,
          word: card.word,
          meaning: card.meaning,
        },
        message: "Flashcard created.",
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
