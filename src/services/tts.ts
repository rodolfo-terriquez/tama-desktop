/**
 * TTS Engine abstraction layer.
 * All conversation/UI code imports from here — never directly from engine files.
 */

import { voicevoxEngine } from "./tts-voicevox";
import { sbv2Engine } from "./tts-sbv2";

// ── Types ──────────────────────────────────────────────

export type TTSEngineType = "voicevox" | "sbv2";

export interface TTSSpeaker {
  name: string;
  id: string;
  styles: { name: string; id: string }[];
}

export interface TTSEngine {
  readonly name: string;
  readonly type: TTSEngineType;
  checkStatus(): Promise<boolean>;
  getSpeakers(): Promise<TTSSpeaker[]>;
  synthesize(text: string, voiceId?: string): Promise<ArrayBuffer>;
}

export interface SpeakOptions {
  voiceId?: string;
  onAmplitude?: (amplitude: number) => void;
  amplitudeSampleRate?: number;
}

export interface VoiceOption {
  id: string;
  name: string;
  speakerName: string;
  styleName: string;
}

// ── Storage keys ───────────────────────────────────────

const STORAGE_KEY_ENGINE = "tama_tts_engine";
const STORAGE_KEY_VOICE = "tama_tts_voice_id";
const STORAGE_KEY_SBV2_URL = "tama_sbv2_url";

export function getStoredEngineType(): TTSEngineType {
  return (localStorage.getItem(STORAGE_KEY_ENGINE) as TTSEngineType) || "voicevox";
}

export function setStoredEngineType(type: TTSEngineType): void {
  localStorage.setItem(STORAGE_KEY_ENGINE, type);
  window.dispatchEvent(new Event("tts-engine-changed"));
}

export function getStoredVoiceId(): string | null {
  return localStorage.getItem(STORAGE_KEY_VOICE);
}

export function setStoredVoiceId(id: string): void {
  localStorage.setItem(STORAGE_KEY_VOICE, id);
}

export function getSBV2BaseUrl(): string {
  return localStorage.getItem(STORAGE_KEY_SBV2_URL) || "http://localhost:5001";
}

export function setSBV2BaseUrl(url: string): void {
  localStorage.setItem(STORAGE_KEY_SBV2_URL, url);
}

// ── Engine registry ────────────────────────────────────

const engines = new Map<TTSEngineType, TTSEngine>();

export function registerEngine(engine: TTSEngine): void {
  engines.set(engine.type, engine);
}

export function getEngine(type?: TTSEngineType): TTSEngine {
  const t = type ?? getStoredEngineType();
  const engine = engines.get(t);
  if (!engine) throw new Error(`TTS engine "${t}" not registered`);
  return engine;
}

// Auto-register built-in engines
registerEngine(voicevoxEngine);
registerEngine(sbv2Engine);

// Migrate legacy VOICEVOX speaker ID to new storage key
(function migrateLegacyVoiceId() {
  const LEGACY_KEY = "tama_voicevox_speaker_id";
  const legacy = localStorage.getItem(LEGACY_KEY);
  if (legacy && !localStorage.getItem(STORAGE_KEY_VOICE)) {
    localStorage.setItem(STORAGE_KEY_VOICE, legacy);
  }
})();

// ── Shared audio playback (Web Audio API) ──────────────

let sharedAudioContext: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;
let isCurrentlyPlaying = false;
let cancelledToken = 0;

function getAudioContext(): AudioContext {
  if (!sharedAudioContext || sharedAudioContext.state === "closed") {
    sharedAudioContext = new AudioContext();
  }
  return sharedAudioContext;
}

export async function playAudio(
  audioData: ArrayBuffer,
  options?: { onAmplitude?: (amplitude: number) => void; amplitudeSampleRate?: number }
): Promise<void> {
  const ctx = getAudioContext();
  if (ctx.state === "suspended") await ctx.resume();

  const audioBuffer = await ctx.decodeAudioData(audioData.slice(0));
  const source = ctx.createBufferSource();
  source.buffer = audioBuffer;

  currentSource = source;
  isCurrentlyPlaying = true;

  let analyser: AnalyserNode | null = null;
  let amplitudeInterval: ReturnType<typeof setInterval> | null = null;

  if (options?.onAmplitude) {
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser);
    analyser.connect(ctx.destination);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const rate = options.amplitudeSampleRate ?? 50;

    amplitudeInterval = setInterval(() => {
      if (analyser) {
        analyser.getByteFrequencyData(dataArray);
        const sum = dataArray.reduce((a, b) => a + b, 0);
        const normalized = Math.min(sum / dataArray.length / 128, 1);
        options.onAmplitude!(normalized);
      }
    }, rate);
  } else {
    source.connect(ctx.destination);
  }

  return new Promise((resolve) => {
    source.onended = () => {
      if (amplitudeInterval) {
        clearInterval(amplitudeInterval);
        options?.onAmplitude?.(0);
      }
      currentSource = null;
      isCurrentlyPlaying = false;
      resolve();
    };
    source.start();
  });
}

export function stopCurrentAudio(): void {
  cancelledToken++;
  if (currentSource && isCurrentlyPlaying) {
    try { currentSource.stop(); } catch { /* already stopped */ }
    currentSource = null;
    isCurrentlyPlaying = false;
  }
}

export function isPlaying(): boolean {
  return isCurrentlyPlaying;
}

// ── Text cleaning ────────────────────────────────────────

const EMOJI_RE =
  /[\p{Emoji_Presentation}\p{Extended_Pictographic}\u200d\ufe0f]/gu;

function stripEmoji(text: string): string {
  return text.replace(EMOJI_RE, "").replace(/\s{2,}/g, " ").trim();
}

// ── Sentence splitting for pipelined playback ───────────

function splitIntoSentences(text: string): string[] {
  // Split on Japanese/standard sentence endings, keeping delimiters attached
  const parts = text.split(/(?<=[。！？!?])\s*/);
  return parts
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ── Public API (delegates to active engine) ────────────

/**
 * Initialize TTS: check active engine, find stored voice or default.
 */
export async function initializeTTS(): Promise<{
  available: boolean;
  speakerId: string;
  speakerName: string;
}> {
  const engine = getEngine();

  const available = await engine.checkStatus();
  if (!available) {
    return { available: false, speakerId: "", speakerName: "Not available" };
  }

  const speakers = await engine.getSpeakers();
  const storedId = getStoredVoiceId();

  // Try to find stored voice
  if (storedId) {
    for (const speaker of speakers) {
      for (const style of speaker.styles) {
        if (style.id === storedId) {
          return {
            available: true,
            speakerId: storedId,
            speakerName: `${speaker.name} (${style.name})`,
          };
        }
      }
    }
  }

  // Fall back to first available
  if (speakers.length > 0 && speakers[0].styles.length > 0) {
    const id = speakers[0].styles[0].id;
    setStoredVoiceId(id);
    return {
      available: true,
      speakerId: id,
      speakerName: `${speakers[0].name} (${speakers[0].styles[0].name})`,
    };
  }

  return { available: false, speakerId: "", speakerName: "No voices" };
}

/**
 * Synthesize and play text using the active engine.
 * Long text is split into sentences and pipelined: all sentences begin
 * synthesizing in parallel, but play back sequentially. This means the
 * first sentence is heard almost immediately while the rest are still
 * being generated.
 */
export async function speak(text: string, options?: SpeakOptions): Promise<void> {
  const engine = getEngine();
  const voiceId = options?.voiceId ?? getStoredVoiceId() ?? undefined;
  const playOpts = {
    onAmplitude: options?.onAmplitude,
    amplitudeSampleRate: options?.amplitudeSampleRate,
  };

  text = stripEmoji(text);
  if (!text) return;

  const sentences = splitIntoSentences(text);
  if (sentences.length <= 1) {
    const audioData = await engine.synthesize(text, voiceId);
    await playAudio(audioData, playOpts);
    return;
  }

  // Kick off all synthesis requests in parallel
  const token = cancelledToken;
  const synthPromises = sentences.map((s) => engine.synthesize(s, voiceId));

  // Play each segment in order as it becomes ready
  for (const promise of synthPromises) {
    if (cancelledToken !== token) return;
    const audioData = await promise;
    if (cancelledToken !== token) return;
    await playAudio(audioData, playOpts);
  }
}

/**
 * Get all voice options for the active engine, flattened for UI selection.
 */
export async function getAllVoiceOptions(): Promise<VoiceOption[]> {
  const engine = getEngine();
  const speakers = await engine.getSpeakers();
  const options: VoiceOption[] = [];

  for (const speaker of speakers) {
    for (const style of speaker.styles) {
      options.push({
        id: style.id,
        name: `${speaker.name} (${style.name})`,
        speakerName: speaker.name,
        styleName: style.name,
      });
    }
  }

  return options;
}

export function getDefaultVoiceId(): string {
  return getStoredVoiceId() || "";
}

export function setDefaultVoiceId(id: string): void {
  setStoredVoiceId(id);
}
