import type { Message, Scenario, OngoingChat, ResponseLength } from "@/types";
import {
  CONVERSATION_TOOLS,
  executeTool,
  trackVocabularyUsage,
  type ToolCall,
  type ToolResult,
} from "@/services/tools";

// ── Provider Config ──────────────────────────────────────────────

export type LLMProvider = "anthropic" | "openrouter";

const STORAGE_KEYS = {
  ANTHROPIC_API_KEY: "tama_anthropic_api_key",
  LLM_PROVIDER: "tama_llm_provider",
  OPENROUTER_API_KEY: "tama_openrouter_api_key",
  OPENROUTER_MODEL: "tama_openrouter_model",
} as const;

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";
const DEFAULT_OPENROUTER_MODEL = "anthropic/claude-sonnet-4-6";
const MAX_TOOL_ROUNDS = 3;

// Anthropic key
export function getApiKey(): string | null {
  return localStorage.getItem(STORAGE_KEYS.ANTHROPIC_API_KEY);
}
export function setApiKey(key: string): void {
  localStorage.setItem(STORAGE_KEYS.ANTHROPIC_API_KEY, key);
}
export function clearApiKey(): void {
  localStorage.removeItem(STORAGE_KEYS.ANTHROPIC_API_KEY);
}

// LLM provider
export function getLLMProvider(): LLMProvider {
  return (localStorage.getItem(STORAGE_KEYS.LLM_PROVIDER) as LLMProvider) || "anthropic";
}
export function setLLMProvider(provider: LLMProvider): void {
  localStorage.setItem(STORAGE_KEYS.LLM_PROVIDER, provider);
}

// OpenRouter
export function getOpenRouterApiKey(): string | null {
  return localStorage.getItem(STORAGE_KEYS.OPENROUTER_API_KEY);
}
export function setOpenRouterApiKey(key: string): void {
  localStorage.setItem(STORAGE_KEYS.OPENROUTER_API_KEY, key);
}
export function clearOpenRouterApiKey(): void {
  localStorage.removeItem(STORAGE_KEYS.OPENROUTER_API_KEY);
  localStorage.removeItem(STORAGE_KEYS.OPENROUTER_MODEL);
}
export function getOpenRouterModel(): string {
  return localStorage.getItem(STORAGE_KEYS.OPENROUTER_MODEL) || DEFAULT_OPENROUTER_MODEL;
}
export function setOpenRouterModel(model: string): void {
  localStorage.setItem(STORAGE_KEYS.OPENROUTER_MODEL, model);
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

function anthropicToolsToOpenRouter(tools: typeof CONVERSATION_TOOLS) {
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
  options?: { tools?: typeof CONVERSATION_TOOLS; maxTokens?: number }
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

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Anthropic API error:", errorText);
    throw new ClaudeError(`API request failed: ${response.statusText}`, response.status);
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
  options?: { tools?: typeof CONVERSATION_TOOLS; maxTokens?: number }
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

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("OpenRouter API error:", errorText);
    throw new ClaudeError(`API request failed: ${response.statusText}`, response.status);
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
  systemPrompt: string
): Promise<string> {
  const provider = getLLMProvider();
  if (provider === "openrouter") {
    return sendMessageWithToolsOR(messages, systemPrompt);
  }
  return sendMessageWithToolsAnthropic(messages, systemPrompt);
}

async function sendMessageWithToolsAnthropic(
  messages: Message[],
  systemPrompt: string
): Promise<string> {
  let apiMessages: AnthropicApiMessage[] = toAnthropicMessages(messages);
  if (apiMessages.length === 0) {
    apiMessages = [{ role: "user", content: "会話を始めてください。" }];
  }

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const result = await callAnthropic(systemPrompt, apiMessages, {
      tools: CONVERSATION_TOOLS,
    });

    if (!result.isToolUse) {
      if (!result.text) throw new ClaudeError("No text content in response");
      await trackVocabularyUsage(result.text);
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
  systemPrompt: string
): Promise<string> {
  let orMessages: OpenRouterMessage[] = toOpenRouterMessages(messages);
  if (orMessages.length === 0) {
    orMessages = [{ role: "user", content: "会話を始めてください。" }];
  }

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const result = await callOpenRouter(systemPrompt, orMessages, {
      tools: CONVERSATION_TOOLS,
    });

    if (!result.isToolUse) {
      if (!result.text) throw new ClaudeError("No text content in response");
      await trackVocabularyUsage(result.text);
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

/**
 * Get system prompt for Japanese conversation practice based on JLPT level
 */
export function getConversationSystemPrompt(
  jlptLevel: string = "N5",
  autoAdjust: boolean = false,
  responseLength: ResponseLength = "natural"
): string {
  const levelGuidelines = JLPT_GUIDELINES[jlptLevel] || JLPT_GUIDELINES.N5;
  const lengthRule = RESPONSE_LENGTH_INSTRUCTIONS[responseLength];
  
  const adjustmentNote = autoAdjust 
    ? "\n\nNOTE: If the user demonstrates consistent competence, you may gradually introduce slightly more advanced vocabulary or grammar to challenge them."
    : "";

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

TOOLS:
You have tools available to look up the student's profile and their SRS vocabulary.
- At the START of a conversation (your first message), call get_due_vocabulary to check for review words, and optionally get_user_profile to adapt.
- During conversation, try to naturally use 1-2 due vocabulary words when the topic allows. Don't force them — only use them when they fit naturally.
- You do NOT need to call tools every turn. Use them once at the start and occasionally if the conversation shifts topics.

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
  responseLength: ResponseLength = "natural"
): string {
  const basePrompt = getConversationSystemPrompt(jlptLevel, autoAdjust, responseLength);

  const customBlock = scenario.custom_prompt
    ? `\n\nCONVERSATION STRUCTURE / SPECIAL INSTRUCTIONS:\n${scenario.custom_prompt}`
    : "";

  return `${basePrompt}

CURRENT SCENARIO:
Title: ${scenario.title} (${scenario.title_ja})
Setting: ${scenario.setting}
Your role: ${scenario.character_role}
Objectives for the student: ${scenario.objectives.join(", ")}${customBlock}

${suffix}`;
}

// ── Translation & Feedback ───────────────────────────────────────

/**
 * Translate Japanese text to English
 */
export async function translateToEnglish(japaneseText: string): Promise<string> {
  const systemPrompt =
    "You are a Japanese to English translator. Translate the given Japanese text to natural English. Only output the translation, nothing else.";
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

/**
 * Generate feedback for a conversation session.
 * `context` can be a scenario ({ title, description }) or an ongoing chat ({ name, persona }).
 */
export async function generateFeedback(
  messages: Message[],
  context: { title: string; description: string } | { name: string; persona: string }
): Promise<string> {
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
    { "issue": "what the student said wrong", "correction": "correct form", "explanation": "brief explanation in English" }
  ],
  "vocabulary": [
    { "word": "Japanese word", "reading": "hiragana reading", "meaning": "English meaning", "example": "example sentence using the word", "source_session": "${new Date().toISOString().split("T")[0]}" }
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

Be encouraging but honest.`;

  const provider = getLLMProvider();

  if (provider === "openrouter") {
    const result = await callOpenRouter(
      systemPrompt,
      [{ role: "user", content: userMessage }],
      { maxTokens: 2048 }
    );
    if (!result.text) throw new ClaudeError("No text content in feedback response");
    return result.text;
  }

  const result = await callAnthropic(
    systemPrompt,
    [{ role: "user", content: userMessage }],
    { maxTokens: 2048 }
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
  responseLength: ResponseLength = "natural"
): string {
  const levelGuidelines = JLPT_GUIDELINES[jlptLevel] || JLPT_GUIDELINES.N5;
  const lengthRule = RESPONSE_LENGTH_INSTRUCTIONS[responseLength];

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
