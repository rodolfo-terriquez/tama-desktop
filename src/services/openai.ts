// In Tauri, the webview can call external APIs directly (no CORS restrictions)
const OPENAI_API_URL = "https://api.openai.com/v1/audio/transcriptions";

// Store API key in localStorage
const API_KEY_STORAGE_KEY = "tama_openai_api_key";

function emitConfigChanged(): void {
  window.dispatchEvent(new Event("tama-config-changed"));
}

export function getOpenAIApiKey(): string | null {
  return localStorage.getItem(API_KEY_STORAGE_KEY);
}

export function setOpenAIApiKey(key: string): void {
  localStorage.setItem(API_KEY_STORAGE_KEY, key);
  emitConfigChanged();
}

export function clearOpenAIApiKey(): void {
  localStorage.removeItem(API_KEY_STORAGE_KEY);
  emitConfigChanged();
}

export function hasOpenAIApiKey(): boolean {
  return getOpenAIApiKey() !== null;
}

export class WhisperError extends Error {
  statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "WhisperError";
    this.statusCode = statusCode;
  }
}

/**
 * Options for transcription
 */
export interface TranscribeOptions {
  /** Language code (e.g., "ja" for Japanese). If not set, defaults to Japanese. */
  language?: string;
  /** 
   * Prompt to guide transcription. Can include vocabulary hints, context, or style.
   * Whisper will try to match the style and vocabulary of the prompt.
   */
  prompt?: string;
  /**
   * Temperature for sampling (0-1). Lower = more deterministic.
   * Default is 0 for most accurate transcription.
   */
  temperature?: number;
}

/**
 * Strip Whisper hallucinations caused by trailing silence in audio.
 * Whisper outputs repetitive characters when processing silence segments.
 */
function cleanTranscription(text: string): string {
  let cleaned = text;
  let prev = "";
  // Iteratively strip trailing runs of any single repeated character (4+ of the same)
  while (cleaned !== prev) {
    prev = cleaned;
    cleaned = cleaned.replace(/(.)\1{3,}$/u, "");
  }
  return cleaned.trim();
}

/**
 * Transcribe audio using OpenAI Whisper API
 * @param audioBlob - Audio blob (webm, mp3, wav, etc.)
 * @param options - Transcription options
 * @returns Transcribed text
 */
export async function transcribeAudio(
  audioBlob: Blob,
  options: TranscribeOptions = {}
): Promise<string> {
  const apiKey = getOpenAIApiKey();

  if (!apiKey) {
    throw new WhisperError("OpenAI API key not set");
  }

  const {
    language = "ja", // Default to Japanese for this app
    prompt,
    temperature = 0, // Most deterministic/accurate
  } = options;

  // Create form data with the audio file
  const formData = new FormData();
  formData.append("file", audioBlob, "audio.webm");
  formData.append("model", "whisper-1");
  formData.append("response_format", "text");
  formData.append("language", language);
  formData.append("temperature", temperature.toString());
  
  // Add prompt if provided - this helps with specific vocabulary
  if (prompt) {
    formData.append("prompt", prompt);
  }

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Whisper API error:", errorText);
    throw new WhisperError(
      `Transcription failed: ${response.statusText}`,
      response.status
    );
  }

  // Response is plain text when response_format is "text"
  const text = await response.text();
  return cleanTranscription(text);
}
