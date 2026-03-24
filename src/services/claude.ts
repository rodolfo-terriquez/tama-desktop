import type { AppLocale, Message, OngoingChat, ResponseLength, Scenario, ShadowTurn, UserProfile } from "@/types";
import {
  CONVERSATION_TOOLS,
  type ToolDefinition,
  executeTool,
  trackVocabularyUsage,
  type ToolCall,
  type ToolResult,
} from "@/services/tools";

// ── Provider Config ──────────────────────────────────────────────

export type LLMProvider = "anthropic" | "openrouter";

export interface GeneratedCustomScenarioDetails {
  title_ja: string;
  setting: string;
  character_role: string;
  objectives: string[];
  custom_prompt?: string;
}

export interface GeneratedShadowScript {
  turns: ShadowTurn[];
  focusPhrases: string[];
}

const STORAGE_KEYS = {
  ANTHROPIC_API_KEY: "tama_anthropic_api_key",
  LLM_PROVIDER: "tama_llm_provider",
  OPENROUTER_API_KEY: "tama_openrouter_api_key",
  OPENROUTER_MODEL: "tama_openrouter_model",
} as const;

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";
const DEFAULT_OPENROUTER_MODEL = "anthropic/claude-sonnet-4-6";
const MAX_TOOL_ROUNDS = 3;

function emitConfigChanged(): void {
  window.dispatchEvent(new Event("tama-config-changed"));
}

// Anthropic key
export function getApiKey(): string | null {
  return localStorage.getItem(STORAGE_KEYS.ANTHROPIC_API_KEY);
}
export function setApiKey(key: string): void {
  localStorage.setItem(STORAGE_KEYS.ANTHROPIC_API_KEY, key);
  emitConfigChanged();
}
export function clearApiKey(): void {
  localStorage.removeItem(STORAGE_KEYS.ANTHROPIC_API_KEY);
  emitConfigChanged();
}

// LLM provider
export function getLLMProvider(): LLMProvider {
  return (localStorage.getItem(STORAGE_KEYS.LLM_PROVIDER) as LLMProvider) || "anthropic";
}
export function setLLMProvider(provider: LLMProvider): void {
  localStorage.setItem(STORAGE_KEYS.LLM_PROVIDER, provider);
  emitConfigChanged();
}

// OpenRouter
export function getOpenRouterApiKey(): string | null {
  return localStorage.getItem(STORAGE_KEYS.OPENROUTER_API_KEY);
}
export function setOpenRouterApiKey(key: string): void {
  localStorage.setItem(STORAGE_KEYS.OPENROUTER_API_KEY, key);
  emitConfigChanged();
}
export function clearOpenRouterApiKey(): void {
  localStorage.removeItem(STORAGE_KEYS.OPENROUTER_API_KEY);
  localStorage.removeItem(STORAGE_KEYS.OPENROUTER_MODEL);
  emitConfigChanged();
}
export function getOpenRouterModel(): string {
  return localStorage.getItem(STORAGE_KEYS.OPENROUTER_MODEL) || DEFAULT_OPENROUTER_MODEL;
}
export function setOpenRouterModel(model: string): void {
  localStorage.setItem(STORAGE_KEYS.OPENROUTER_MODEL, model);
  emitConfigChanged();
}

/**
 * Check if the active LLM provider has an API key configured.
 */
export function hasApiKey(): boolean {
  const provider = getLLMProvider();
  if (provider === "openrouter") return getOpenRouterApiKey() !== null;
  return getApiKey() !== null;
}

// ── Error ────────────────────────────────────────────────────────

export class ClaudeError extends Error {
  statusCode?: number;
  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "ClaudeError";
    this.statusCode = statusCode;
  }
}

function extractApiErrorMessage(errorText: string): string | null {
  const trimmed = errorText.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return parsed.message.trim();
    }
    if (typeof parsed.error === "string" && parsed.error.trim()) {
      return parsed.error.trim();
    }
    if (parsed.error && typeof parsed.error === "object") {
      const nested = parsed.error as Record<string, unknown>;
      if (typeof nested.message === "string" && nested.message.trim()) {
        return nested.message.trim();
      }
      if (typeof nested.type === "string" && nested.type.trim()) {
        return nested.type.trim();
      }
    }
  } catch {
    // Not JSON; fall through to plain text handling.
  }

  return trimmed.length > 240 ? `${trimmed.slice(0, 240)}...` : trimmed;
}

function buildApiFailureMessage(provider: "Anthropic" | "OpenRouter", response: Response, errorText: string): string {
  const statusLabel = response.statusText
    ? `${response.status} ${response.statusText}`
    : `${response.status}`;
  const apiDetail = extractApiErrorMessage(errorText);
  return apiDetail
    ? `${provider} API request failed (HTTP ${statusLabel}): ${apiDetail}`
    : `${provider} API request failed (HTTP ${statusLabel})`;
}

function buildNetworkFailureMessage(provider: "Anthropic" | "OpenRouter", err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err);
  return `${provider} API network request failed: ${detail}`;
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) throw new ClaudeError("No JSON returned by the AI");

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

// ── Anthropic Types & Helpers ────────────────────────────────────

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | ToolResult;

interface AnthropicApiMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

interface AnthropicResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: ContentBlock[];
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
}

function extractText(content: ContentBlock[]): string {
  return content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function extractToolCalls(content: ContentBlock[]): ToolCall[] {
  return content
    .filter(
      (b): b is { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } =>
        b.type === "tool_use"
    )
    .map((b) => ({ id: b.id, name: b.name, input: b.input }));
}

// ── OpenRouter Types & Helpers ───────────────────────────────────

interface OpenRouterMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OpenRouterToolCall[];
  tool_call_id?: string;
}

interface OpenRouterToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenRouterResponse {
  choices: [{
    message: {
      role: "assistant";
      content: string | null;
      tool_calls?: OpenRouterToolCall[];
    };
    finish_reason: string;
  }];
}

function anthropicToolsToOpenRouter(tools: ToolDefinition[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

// ── Core API Calls ───────────────────────────────────────────────

async function callAnthropic(
  systemPrompt: string,
  messages: AnthropicApiMessage[],
  options?: { tools?: ToolDefinition[]; maxTokens?: number }
): Promise<{ text: string; toolCalls: ToolCall[]; isToolUse: boolean; rawContent: ContentBlock[] }> {
  const apiKey = getApiKey();
  if (!apiKey) throw new ClaudeError("Anthropic API key not set");

  const body: Record<string, unknown> = {
    model: DEFAULT_ANTHROPIC_MODEL,
    max_tokens: options?.maxTokens ?? 1024,
    system: systemPrompt,
    messages,
  };
  if (options?.tools) body.tools = options.tools;

  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new ClaudeError(buildNetworkFailureMessage("Anthropic", err));
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Anthropic API error:", errorText);
    throw new ClaudeError(buildApiFailureMessage("Anthropic", response, errorText), response.status);
  }

  const data: AnthropicResponse = await response.json();
  return {
    text: extractText(data.content),
    toolCalls: extractToolCalls(data.content),
    isToolUse: data.stop_reason === "tool_use",
    rawContent: data.content,
  };
}

async function callOpenRouter(
  systemPrompt: string,
  messages: OpenRouterMessage[],
  options?: { tools?: ToolDefinition[]; maxTokens?: number }
): Promise<{ text: string; toolCalls: ToolCall[]; isToolUse: boolean; rawMessage: OpenRouterMessage }> {
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) throw new ClaudeError("OpenRouter API key not set");

  const model = getOpenRouterModel();
  const allMessages: OpenRouterMessage[] = [
    { role: "system", content: systemPrompt },
    ...messages,
  ];

  const body: Record<string, unknown> = {
    model,
    max_tokens: options?.maxTokens ?? 1024,
    messages: allMessages,
  };
  if (options?.tools) body.tools = anthropicToolsToOpenRouter(options.tools);

  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new ClaudeError(buildNetworkFailureMessage("OpenRouter", err));
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error("OpenRouter API error:", errorText);
    throw new ClaudeError(buildApiFailureMessage("OpenRouter", response, errorText), response.status);
  }

  const data: OpenRouterResponse = await response.json();
  const choice = data.choices[0];
  const toolCalls = (choice.message.tool_calls ?? []).map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    input: JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>,
  }));

  return {
    text: choice.message.content ?? "",
    toolCalls,
    isToolUse: choice.finish_reason === "tool_calls",
    rawMessage: {
      role: "assistant",
      content: choice.message.content,
      tool_calls: choice.message.tool_calls,
    },
  };
}

// ── Public API ───────────────────────────────────────────────────

function toAnthropicMessages(messages: Message[]): AnthropicApiMessage[] {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

function toOpenRouterMessages(messages: Message[]): OpenRouterMessage[] {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

/**
 * Send a message and get a response (no tools).
 */
export async function sendMessage(
  messages: Message[],
  systemPrompt: string
): Promise<string> {
  const provider = getLLMProvider();

  if (provider === "openrouter") {
    let orMessages = toOpenRouterMessages(messages);
    if (orMessages.length === 0) {
      orMessages = [{ role: "user", content: "会話を始めてください。" }];
    }
    const result = await callOpenRouter(systemPrompt, orMessages);
    if (!result.text) throw new ClaudeError("No text content in response");
    return result.text;
  }

  let apiMessages = toAnthropicMessages(messages);
  if (apiMessages.length === 0) {
    apiMessages = [{ role: "user", content: "会話を始めてください。" }];
  }
  const result = await callAnthropic(systemPrompt, apiMessages);
  if (!result.text) throw new ClaudeError("No text content in response");
  return result.text;
}

/**
 * Send a message with tool use support.
 * Handles the tool use loop internally — callers only see the final text.
 * Also tracks vocabulary usage in the AI response.
 */
export async function sendMessageWithTools(
  messages: Message[],
  systemPrompt: string,
  options?: { tools?: ToolDefinition[]; trackVocabularyUsage?: boolean }
): Promise<string> {
  const tools = options?.tools ?? CONVERSATION_TOOLS;
  const shouldTrackVocabulary = options?.trackVocabularyUsage ?? true;
  const provider = getLLMProvider();
  if (provider === "openrouter") {
    return sendMessageWithToolsOR(messages, systemPrompt, tools, shouldTrackVocabulary);
  }
  return sendMessageWithToolsAnthropic(messages, systemPrompt, tools, shouldTrackVocabulary);
}

async function sendMessageWithToolsAnthropic(
  messages: Message[],
  systemPrompt: string,
  tools: ToolDefinition[],
  shouldTrackVocabulary: boolean
): Promise<string> {
  let apiMessages: AnthropicApiMessage[] = toAnthropicMessages(messages);
  if (apiMessages.length === 0) {
    apiMessages = [{ role: "user", content: "会話を始めてください。" }];
  }

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const result = await callAnthropic(systemPrompt, apiMessages, {
      tools,
    });

    if (!result.isToolUse) {
      if (!result.text) throw new ClaudeError("No text content in response");
      if (shouldTrackVocabulary) {
        await trackVocabularyUsage(result.text);
      }
      return result.text;
    }

    const toolResults: ToolResult[] = await Promise.all(result.toolCalls.map(executeTool));
    apiMessages = [
      ...apiMessages,
      { role: "assistant", content: result.rawContent },
      { role: "user", content: toolResults },
    ];
  }

  throw new ClaudeError("Too many tool use rounds");
}

async function sendMessageWithToolsOR(
  messages: Message[],
  systemPrompt: string,
  tools: ToolDefinition[],
  shouldTrackVocabulary: boolean
): Promise<string> {
  let orMessages: OpenRouterMessage[] = toOpenRouterMessages(messages);
  if (orMessages.length === 0) {
    orMessages = [{ role: "user", content: "会話を始めてください。" }];
  }

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const result = await callOpenRouter(systemPrompt, orMessages, {
      tools,
    });

    if (!result.isToolUse) {
      if (!result.text) throw new ClaudeError("No text content in response");
      if (shouldTrackVocabulary) {
        await trackVocabularyUsage(result.text);
      }
      return result.text;
    }

    const toolResultMessages: OpenRouterMessage[] = [];
    for (const tc of result.toolCalls) {
      const toolResult = await executeTool(tc);
      toolResultMessages.push({
        role: "tool" as const,
        content: toolResult.content,
        tool_call_id: tc.id,
      });
    }

    orMessages = [
      ...orMessages,
      result.rawMessage,
      ...toolResultMessages,
    ];
  }

  throw new ClaudeError("Too many tool use rounds");
}

// ── JLPT Guidelines ─────────────────────────────────────────────

const JLPT_GUIDELINES: Record<string, string> = {
  N5: `JLPT N5 (Beginner):
- Use only basic vocabulary (~800 words) and simple grammar
- Stick to present/past tense, basic て-form, ます/です forms
- Use common kanji only (~100), prefer hiragana when possible
- Short, simple sentences
- Topics: self-introduction, daily routines, basic shopping, weather`,

  N4: `JLPT N4 (Elementary):
- Use elementary vocabulary (~1,500 words) and grammar
- Can use て-form connections, たい-form, potential form, ないで
- Use basic kanji (~300)
- Sentences can be slightly longer with simple conjunctions
- Topics: hobbies, travel plans, giving/receiving, making requests`,

  N3: `JLPT N3 (Intermediate):
- Use intermediate vocabulary (~3,000 words)
- Can use passive, causative, conditionals (たら、ば、なら)
- Use intermediate kanji (~650)
- Natural sentence structures with multiple clauses
- Topics: opinions, explanations, news, workplace situations`,

  N2: `JLPT N2 (Upper Intermediate):
- Use advanced vocabulary (~6,000 words)
- Complex grammar including formal expressions, indirect speech
- Use most common kanji (~1,000)
- Natural, nuanced expressions
- Topics: abstract discussions, current events, formal situations`,

  N1: `JLPT N1 (Advanced):
- Use native-level vocabulary and expressions
- All grammar patterns including literary and formal styles
- Full kanji usage (~2,000+)
- Idiomatic expressions, keigo nuances
- Topics: any topic at native complexity`,
};

const RESPONSE_LENGTH_INSTRUCTIONS: Record<ResponseLength, string> = {
  short: "Keep responses very short — 1 sentence, like a quick text message. Avoid long explanations.",
  natural: "Keep responses conversational and natural (1-3 sentences typically).",
  long: "Feel free to write longer, more detailed responses (3-5 sentences). Elaborate on topics, ask follow-up questions, and share your thoughts.",
};

type PersonalContext = Pick<UserProfile, "name" | "age" | "aboutYou">;

function buildPersonalContextBlock(context?: PersonalContext): string {
  if (!context) return "";

  const lines: string[] = [];
  if (context.name?.trim()) lines.push(`- Name: ${context.name.trim()}`);
  if (typeof context.age === "number") lines.push(`- Age: ${context.age}`);
  if (context.aboutYou?.trim()) lines.push(`- About: ${context.aboutYou.trim()}`);
  if (lines.length === 0) return "";

  return `\n\nSTUDENT PERSONAL CONTEXT (optional):\n${lines.join("\n")}\nUse this naturally when relevant, but do not force it every turn.`;
}

/**
 * Get system prompt for Japanese conversation practice based on JLPT level
 */
export function getConversationSystemPrompt(
  jlptLevel: string = "N5",
  autoAdjust: boolean = false,
  responseLength: ResponseLength = "natural",
  includeFlashcardVocab: boolean = true
): string {
  const levelGuidelines = JLPT_GUIDELINES[jlptLevel] || JLPT_GUIDELINES.N5;
  const lengthRule = RESPONSE_LENGTH_INSTRUCTIONS[responseLength];
  
  const adjustmentNote = autoAdjust 
    ? "\n\nNOTE: If the user demonstrates consistent competence, you may gradually introduce slightly more advanced vocabulary or grammar to challenge them."
    : "";

  const toolsBlock = includeFlashcardVocab
    ? `

TOOLS:
You have tools available to look up the student's profile and their SRS vocabulary.
- At the START of a conversation (your first message), call get_due_vocabulary to check for review words, and optionally get_user_profile to adapt.
- During conversation, try to naturally use 1-2 due vocabulary words when the topic allows. Don't force them — only use them when they fit naturally.
- You do NOT need to call tools every turn. Use them once at the start and occasionally if the conversation shifts topics.`
    : `

FLASHCARD REVIEW:
- Do not intentionally introduce saved flashcard vocabulary just for review.
- Focus on a natural conversation that fits the scenario and the student's level.`;

  return `You are a native Japanese speaker helping someone practice conversational Japanese. You are currently role-playing in a scenario.

STUDENT'S LEVEL:
${levelGuidelines}
${adjustmentNote}

IMPORTANT RULES:
1. ALWAYS respond in Japanese only. Never include romaji, romanized Japanese, or English translations unless the student explicitly asks for help in English.
2. Match your language complexity to the student's JLPT level described above
3. Only switch to English if the student writes in English to ask a question (e.g. "How do I say...?"). In that case, briefly answer in English, then return to Japanese.
4. Stay in character for the scenario
5. ${lengthRule}
6. If the user makes a mistake, gently incorporate the correction into your response without breaking character
7. Do NOT add parenthetical translations, romaji readings, or English glosses. The student has a translate button they can use.
8. Write Japanese text CONTINUOUSLY without spaces between words, exactly as natural Japanese is written. Only use punctuation (。、！？) to separate clauses — NEVER insert spaces between Japanese words.
${toolsBlock}

You will be given a scenario to role-play. Stay in character and help the user practice.`;
}

/**
 * Build a full system prompt for a conversation scenario,
 * including custom_prompt instructions if present.
 */
export function buildScenarioPrompt(
  scenario: Scenario,
  jlptLevel: string = "N5",
  autoAdjust: boolean = false,
  suffix: string = "Continue the conversation in character.",
  responseLength: ResponseLength = "natural",
  personalContext?: PersonalContext,
  includeFlashcardVocab: boolean = true
): string {
  const basePrompt = getConversationSystemPrompt(
    jlptLevel,
    autoAdjust,
    responseLength,
    includeFlashcardVocab
  );
  const personalContextBlock = buildPersonalContextBlock(personalContext);

  const customBlock = scenario.custom_prompt
    ? `\n\nCONVERSATION STRUCTURE / SPECIAL INSTRUCTIONS:\n${scenario.custom_prompt}`
    : "";

  return `${basePrompt}

CURRENT SCENARIO:
Title: ${scenario.title} (${scenario.title_ja})
Setting: ${scenario.setting}
Your role: ${scenario.character_role}
Objectives for the student: ${scenario.objectives.join(", ")}${customBlock}${personalContextBlock}

${suffix}`;
}

function getShadowTurnCountInstruction(responseLength: ResponseLength): string {
  switch (responseLength) {
    case "short":
      return "Write exactly 6 turns total (3 assistant lines and 3 user lines).";
    case "long":
      return "Write exactly 10 turns total (5 assistant lines and 5 user lines).";
    case "natural":
    default:
      return "Write exactly 8 turns total (4 assistant lines and 4 user lines).";
  }
}

function inferAssistantSpeakerLabel(scenario: Scenario, turns: ShadowTurn[]): string {
  const fromTitle = scenario.title.match(/\bwith\s+(.+)$/i)?.[1]?.trim();
  if (fromTitle) {
    return fromTitle;
  }

  for (const turn of turns) {
    if (turn.speaker !== "user") {
      continue;
    }

    const directAddress = turn.text.match(/[、,\s]([^、。！？!?]+?さん)[、。！？!?]/u)?.[1]?.trim();
    if (directAddress) {
      return directAddress;
    }
  }

  return "Partner";
}

export async function generateShadowScript(
  scenario: Scenario,
  jlptLevel: string = "N5",
  responseLength: ResponseLength = "natural",
  personalContext?: PersonalContext
): Promise<GeneratedShadowScript> {
  const levelGuidelines = JLPT_GUIDELINES[jlptLevel] || JLPT_GUIDELINES.N5;
  const personalContextBlock = buildPersonalContextBlock(personalContext);
  const customBlock = scenario.custom_prompt
    ? `\n\nCONVERSATION STRUCTURE / SPECIAL INSTRUCTIONS:\n${scenario.custom_prompt}`
    : "";

  const systemPrompt = `You write fixed Japanese shadowing scripts for a language-learning app. Return ONLY valid JSON with no markdown fences and no extra commentary.

Output schema:
{
  "turns": [
    { "speaker": "assistant", "speaker_label": "short speaker label", "text": "Japanese line", "reading": "hiragana reading of the full line" },
    { "speaker": "user", "speaker_label": "short speaker label", "text": "Japanese line the learner should say", "reading": "hiragana reading of the full line" }
  ],
  "focus_phrases": ["useful Japanese phrase 1", "useful Japanese phrase 2"]
}

Rules:
- The script must alternate strictly between assistant and user.
- The first turn must always be the assistant.
- ${getShadowTurnCountInstruction(responseLength)}
- Every "text" value must be natural Japanese only. No romaji, no translations, no explanations.
- Every turn must include a "reading" value written entirely in hiragana for the full line.
- The "reading" must match the Japanese text exactly in meaning and order, but with kanji converted to hiragana.
- Every turn must include a concise "speaker_label" value for the current speaker.
- Keep speaker_label short and consistent across the script, for example "ユキさん", "店員さん", "医者", or "あなた".
- Keep the dialogue practical, repeatable, and suitable for speaking drills.
- The user's lines should be correct model answers worth practicing verbatim.
- Match the learner's JLPT level and keep the wording comprehensible for that level.
- Use concise, natural spoken Japanese with no spaces between Japanese words.
- Include 3 to 6 focus_phrases taken from the script. Keep them short and useful.`;

  const userMessage = `Create a fixed shadowing script for this scenario.

STUDENT LEVEL:
${levelGuidelines}

SCENARIO:
Title: ${scenario.title} (${scenario.title_ja})
Setting: ${scenario.setting}
Assistant role: ${scenario.character_role}
Objectives: ${scenario.objectives.join(", ")}${customBlock}${personalContextBlock}`;

  const provider = getLLMProvider();
  const responseText =
    provider === "openrouter"
      ? (await callOpenRouter(systemPrompt, [{ role: "user", content: userMessage }], { maxTokens: 2400 })).text
      : (await callAnthropic(systemPrompt, [{ role: "user", content: userMessage }], { maxTokens: 2400 })).text;

  if (!responseText) {
    throw new ClaudeError("No text content in shadow script response");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(responseText));
  } catch {
    throw new ClaudeError("The AI returned an invalid shadow script");
  }

  const data = parsed as Record<string, unknown>;
  const rawTurns: Array<{
    speaker: ShadowTurn["speaker"] | null;
    text: string;
    reading?: string;
    speakerLabel?: string;
    cue?: string;
  }> = [];

  if (Array.isArray(data.turns)) {
    for (const item of data.turns) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const record = item as Record<string, unknown>;
      const rawSpeaker = typeof record.speaker === "string" ? record.speaker.trim().toLowerCase() : "";
      const speaker =
        rawSpeaker === "assistant" || rawSpeaker === "ai" || rawSpeaker === "partner" || rawSpeaker === "teacher"
          ? "assistant"
          : rawSpeaker === "user" || rawSpeaker === "learner" || rawSpeaker === "student" || rawSpeaker === "you"
            ? "user"
            : null;
      const text = typeof record.text === "string" ? record.text.trim() : "";
      const speakerLabel =
        typeof record.speaker_label === "string" && record.speaker_label.trim()
          ? record.speaker_label.trim()
          : undefined;
      const reading =
        typeof record.reading === "string" && record.reading.trim()
          ? record.reading.trim()
          : undefined;
      const cue =
        typeof record.cue === "string" && record.cue.trim()
          ? record.cue.trim()
          : undefined;

      if (!text) {
        continue;
      }

      rawTurns.push({ speaker, text, reading, speakerLabel, cue });
    }
  }

  if (rawTurns.length < 2) {
    throw new ClaudeError("The AI shadow script did not contain valid alternating turns");
  }

  const trimmedTurns = rawTurns.length % 2 === 0 ? rawTurns : rawTurns.slice(0, -1);
  if (trimmedTurns.length < 2) {
    throw new ClaudeError("The AI shadow script did not contain valid alternating turns");
  }

  const normalizedTurns: ShadowTurn[] = trimmedTurns.map((turn, index) => ({
    speaker: index % 2 === 0 ? "assistant" : "user",
    text: turn.text,
    reading: turn.reading,
    speakerLabel: turn.speakerLabel,
    cue: turn.cue,
  }));

  const assistantSpeakerLabel = inferAssistantSpeakerLabel(scenario, normalizedTurns);
  const hydratedTurns = normalizedTurns.map((turn) => ({
    ...turn,
    reading: turn.reading?.trim() || turn.text,
    speakerLabel:
      turn.speakerLabel?.trim() ||
      (turn.speaker === "assistant" ? assistantSpeakerLabel : "You"),
  }));

  const focusPhrases = Array.isArray(data.focus_phrases)
    ? data.focus_phrases
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim())
        .slice(0, 6)
    : [];

  return {
    turns: hydratedTurns,
    focusPhrases,
  };
}

export async function generateCustomScenarioDetails(
  title: string,
  description: string,
  targetLocale: AppLocale = "en"
): Promise<GeneratedCustomScenarioDetails> {
  const targetLanguage = getTranslationTargetLanguage(targetLocale);
  const systemPrompt = `You help generate Japanese conversation-practice scenarios for a language learning app. Return ONLY valid JSON with no markdown fences and no extra commentary.

Output schema:
{
  "title_ja": "short Japanese title",
  "setting": "1-2 sentence scenario setup",
  "character_role": "who the AI should play",
  "objectives": ["objective 1", "objective 2", "objective 3"],
  "custom_prompt": "optional extra flow instructions or empty string"
}

Guidelines:
- Keep everything concise and practical for spoken conversation practice.
- Make the scenario feel realistic and easy to role-play.
- Objectives should be specific student actions.
- Write setting, character_role, objectives, and custom_prompt in natural ${targetLanguage}.
- Use natural Japanese for title_ja.
- Leave custom_prompt empty unless extra structure would genuinely help.`;

  const userMessage = `Generate the remaining details for this custom scenario.

Title: ${title.trim()}
Description: ${description.trim()}`;

  const provider = getLLMProvider();
  const responseText =
    provider === "openrouter"
      ? (await callOpenRouter(systemPrompt, [{ role: "user", content: userMessage }], { maxTokens: 1400 })).text
      : (await callAnthropic(systemPrompt, [{ role: "user", content: userMessage }], { maxTokens: 1400 })).text;

  if (!responseText) {
    throw new ClaudeError("No text content in custom scenario response");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(responseText));
  } catch {
    throw new ClaudeError("The AI returned an invalid scenario draft");
  }

  const data = parsed as Record<string, unknown>;
  const objectives = Array.isArray(data.objectives)
    ? data.objectives.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];

  if (
    typeof data.setting !== "string" ||
    typeof data.character_role !== "string" ||
    objectives.length === 0
  ) {
    throw new ClaudeError("The AI draft was missing required scenario fields");
  }

  return {
    title_ja: typeof data.title_ja === "string" ? data.title_ja.trim() : "",
    setting: data.setting.trim(),
    character_role: data.character_role.trim(),
    objectives,
    custom_prompt:
      typeof data.custom_prompt === "string" && data.custom_prompt.trim()
        ? data.custom_prompt.trim()
        : undefined,
  };
}

// ── Translation & Feedback ───────────────────────────────────────

function getTranslationTargetLanguage(locale: AppLocale): "English" | "Spanish" {
  return locale === "es" ? "Spanish" : "English";
}

/**
 * Translate Japanese text to the current app language.
 */
export async function translateJapaneseText(
  japaneseText: string,
  targetLocale: AppLocale
): Promise<string> {
  const targetLanguage = getTranslationTargetLanguage(targetLocale);
  const systemPrompt =
    `You are a Japanese translator. Translate the given Japanese text to natural ${targetLanguage}. Only output the translation, nothing else.`;
  const provider = getLLMProvider();

  if (provider === "openrouter") {
    const result = await callOpenRouter(systemPrompt, [
      { role: "user", content: japaneseText },
    ]);
    if (!result.text) throw new ClaudeError("No text content in translation response");
    return result.text;
  }

  const result = await callAnthropic(systemPrompt, [
    { role: "user", content: japaneseText },
  ]);
  if (!result.text) throw new ClaudeError("No text content in translation response");
  return result.text;
}

export async function translateToEnglish(japaneseText: string): Promise<string> {
  return translateJapaneseText(japaneseText, "en");
}

/**
 * Generate feedback for a conversation session.
 * `context` can be a scenario ({ title, description }) or an ongoing chat ({ name, persona }).
 */
export async function generateFeedback(
  messages: Message[],
  context: { title: string; description: string } | { name: string; persona: string },
  targetLocale: AppLocale = "en"
): Promise<string> {
  const targetLanguage = getTranslationTargetLanguage(targetLocale);
  const systemPrompt = `You are a Japanese language teacher who reviews practice conversation transcripts and returns structured JSON feedback. You NEVER continue the conversation — you only analyze it. Return ONLY valid JSON, no markdown fences, no extra text.`;

  const transcript = messages
    .map((m) => `[${m.role === "user" ? "Student" : "Teacher"}]: ${m.content}`)
    .join("\n");

  const contextLine = "title" in context
    ? `Scenario: "${context.title}" — ${context.description}`
    : `Ongoing conversation with ${context.name} (${context.persona})`;

  const userMessage = `Please analyze this practice conversation and provide feedback.

${contextLine}

TRANSCRIPT:
${transcript}

Return your analysis as JSON in exactly this format:
{
  "grammar_points": [
    { "issue": "what the student said wrong", "correction": "correct form", "explanation": "brief explanation in ${targetLanguage}" }
  ],
  "vocabulary": [
    { "word": "Japanese word", "reading": "hiragana reading", "meaning": "${targetLanguage} meaning", "example": "short natural Japanese-only example sentence using the word", "source_session": "${new Date().toISOString().split("T")[0]}" }
  ],
  "fluency_notes": ["observations about natural phrasing, nuance, etc."],
  "summary": {
    "topics_covered": ["topic1", "topic2"],
    "performance_rating": "needs_work" or "good" or "excellent",
    "next_session_hint": "suggestion for next practice"
  }
}

Focus on:
- Grammar mistakes the student made
- Key vocabulary from the conversation (especially words the student used or should learn)
- Natural phrasing alternatives
- Overall performance
- Write grammar explanations, vocabulary meanings, fluency notes, topics_covered, and next_session_hint in natural ${targetLanguage}
- For every vocabulary item, the "example" must be written only in Japanese. Do not include English, romaji, translations, glosses, quotes, or parentheses in that field.
- Return a single valid JSON object only. Do not use markdown fences.
- Escape all double quotes inside JSON strings.
- Do not leave any string, array, or object unterminated.

Be encouraging but honest.`;

  const provider = getLLMProvider();

  if (provider === "openrouter") {
    const result = await callOpenRouter(
      systemPrompt,
      [{ role: "user", content: userMessage }],
      { maxTokens: 4096 }
    );
    if (!result.text) throw new ClaudeError("No text content in feedback response");
    return result.text;
  }

  const result = await callAnthropic(
    systemPrompt,
    [{ role: "user", content: userMessage }],
    { maxTokens: 4096 }
  );
  if (!result.text) throw new ClaudeError("No text content in feedback response");
  return result.text;
}

// ── Ongoing Chat ─────────────────────────────────────────────────

const ONGOING_CHAT_MAX_CONTEXT = 20;
export const ONGOING_CHAT_SUMMARIZE_THRESHOLD = 40;
export const ONGOING_CHAT_KEEP_AFTER_SUMMARIZE = 15;

/**
 * Build system prompt for an ongoing persistent chat.
 */
export function buildOngoingChatPrompt(
  chat: OngoingChat,
  jlptLevel: string = "N5",
  autoAdjust: boolean = false,
  responseLength: ResponseLength = "natural",
  personalContext?: PersonalContext
): string {
  const levelGuidelines = JLPT_GUIDELINES[jlptLevel] || JLPT_GUIDELINES.N5;
  const lengthRule = RESPONSE_LENGTH_INSTRUCTIONS[responseLength];
  const personalContextBlock = buildPersonalContextBlock(personalContext);

  const adjustmentNote = autoAdjust
    ? "\n\nNOTE: If the user demonstrates consistent competence, you may gradually introduce slightly more advanced vocabulary or grammar to challenge them."
    : "";

  const summaryBlock = chat.summary
    ? `\n\nCONVERSATION HISTORY SUMMARY:\nThe following summarizes your previous conversations with this student:\n${chat.summary}`
    : "";

  const continuityNote = chat.totalMessages > 0
    ? "Continue the conversation naturally from where you left off. Reference past topics when relevant."
    : "This is your first conversation with this student. Start with a friendly greeting and get to know them.";

  return `You are ${chat.persona}. You are a Japanese friend having a casual ongoing conversation. You and the student have been chatting over many sessions — this is a continuous relationship, not a one-off practice exercise.

STUDENT'S LEVEL:
${levelGuidelines}
${adjustmentNote}

IMPORTANT RULES:
1. ALWAYS respond in Japanese only. Never include romaji, romanized Japanese, or English translations unless the student explicitly asks for help in English.
2. Match your language complexity to the student's JLPT level described above
3. Only switch to English if the student writes in English to ask a question (e.g. "How do I say...?"). In that case, briefly answer in English, then return to Japanese.
4. Stay in character as ${chat.name}
5. ${lengthRule}
6. If the user makes a mistake, gently incorporate the correction into your response without breaking character
7. Do NOT add parenthetical translations, romaji readings, or English glosses. The student has a translate button they can use.
8. Be warm, remember details, and build on the relationship over time.
${summaryBlock}
${personalContextBlock}

${continuityNote}`;
}

/**
 * Get the context window of messages to send to the LLM.
 * Returns only the most recent N messages.
 */
export function getContextMessages(messages: Message[]): Message[] {
  if (messages.length <= ONGOING_CHAT_MAX_CONTEXT) return messages;
  return messages.slice(-ONGOING_CHAT_MAX_CONTEXT);
}

/**
 * Summarize older messages into a compressed summary.
 * Merges with existing summary if present.
 */
export async function summarizeConversation(
  existingSummary: string,
  messagesToSummarize: Message[]
): Promise<string> {
  const systemPrompt = `You are a conversation summarizer. You will receive a previous summary (if any) and a block of conversation messages between a Japanese language student and their AI conversation partner. Produce a concise updated summary that captures:
- Key facts learned about the student (name, job, hobbies, family, etc.)
- Topics discussed and ongoing conversation threads
- The general tone and relationship dynamic
- Any important details the AI friend should remember

Return ONLY the summary text, no headers or formatting. Keep it under 500 words. Write in English for clarity.`;

  const transcript = messagesToSummarize
    .map((m) => `[${m.role === "user" ? "Student" : "AI Friend"}]: ${m.content}`)
    .join("\n");

  const userMessage = existingSummary
    ? `PREVIOUS SUMMARY:\n${existingSummary}\n\nNEW MESSAGES TO INCORPORATE:\n${transcript}`
    : `MESSAGES TO SUMMARIZE:\n${transcript}`;

  const provider = getLLMProvider();

  if (provider === "openrouter") {
    const result = await callOpenRouter(
      systemPrompt,
      [{ role: "user", content: userMessage }],
      { maxTokens: 1024 }
    );
    if (!result.text) throw new ClaudeError("Failed to generate summary");
    return result.text;
  }

  const result = await callAnthropic(
    systemPrompt,
    [{ role: "user", content: userMessage }],
    { maxTokens: 1024 }
  );
  if (!result.text) throw new ClaudeError("Failed to generate summary");
  return result.text;
}

export async function summarizeSenseiConversation(
  existingSummary: string,
  messagesToSummarize: Message[],
  targetLocale: AppLocale = "en"
): Promise<string> {
  const targetLanguage = getTranslationTargetLanguage(targetLocale);
  const systemPrompt = `You summarize a persistent Japanese-learning teacher chat. You will receive the previous summary and a block of messages between the student and Sensei. Produce a concise updated summary that preserves:
- the student's current goals and recurring questions
- useful facts about the student's level, struggles, and preferences
- any study plans, explanations, or follow-up topics Sensei should remember
- important context from the current app views that came up in the discussion

Return ONLY the summary text, no headers or markdown. Keep it under 500 words and write it in natural ${targetLanguage}.`;

  const transcript = messagesToSummarize
    .map((message) => `[${message.role === "user" ? "Student" : "Sensei"}]: ${message.content}`)
    .join("\n");

  const userMessage = existingSummary
    ? `PREVIOUS SUMMARY:\n${existingSummary}\n\nNEW MESSAGES TO INCORPORATE:\n${transcript}`
    : `MESSAGES TO SUMMARIZE:\n${transcript}`;

  const provider = getLLMProvider();

  if (provider === "openrouter") {
    const result = await callOpenRouter(
      systemPrompt,
      [{ role: "user", content: userMessage }],
      { maxTokens: 1024 }
    );
    if (!result.text) throw new ClaudeError("Failed to generate Sensei summary");
    return result.text;
  }

  const result = await callAnthropic(
    systemPrompt,
    [{ role: "user", content: userMessage }],
    { maxTokens: 1024 }
  );
  if (!result.text) throw new ClaudeError("Failed to generate Sensei summary");
  return result.text;
}
