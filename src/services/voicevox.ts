import type { VoicevoxSpeaker } from "@/types";

const VOICEVOX_BASE_URL = "http://localhost:50021";
const STORAGE_KEY_SPEAKER_ID = "tama_voicevox_speaker_id";

// Default to Shikoku Metan normal style (will be confirmed at runtime)
let defaultSpeakerId = 2;

// Load saved speaker ID from localStorage
function loadSavedSpeakerId(): number | null {
  const saved = localStorage.getItem(STORAGE_KEY_SPEAKER_ID);
  if (saved) {
    const id = parseInt(saved, 10);
    if (!isNaN(id)) return id;
  }
  return null;
}

// Save speaker ID to localStorage
function saveSpeakerId(id: number): void {
  localStorage.setItem(STORAGE_KEY_SPEAKER_ID, id.toString());
}

// Shared AudioContext for reuse (better performance)
let sharedAudioContext: AudioContext | null = null;

// Current audio source for interruption support
let currentSource: AudioBufferSourceNode | null = null;
let isCurrentlyPlaying = false;

function getAudioContext(): AudioContext {
  if (!sharedAudioContext || sharedAudioContext.state === "closed") {
    sharedAudioContext = new AudioContext();
  }
  return sharedAudioContext;
}

export class VoicevoxError extends Error {
  statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "VoicevoxError";
    this.statusCode = statusCode;
  }
}

/**
 * Check if VOICEVOX engine is running
 */
export async function checkVoicevoxStatus(): Promise<boolean> {
  try {
    const response = await fetch(`${VOICEVOX_BASE_URL}/version`, {
      method: "GET",
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Get list of available speakers/voices
 */
export async function getSpeakers(): Promise<VoicevoxSpeaker[]> {
  const response = await fetch(`${VOICEVOX_BASE_URL}/speakers`, {
    method: "GET",
  });

  if (!response.ok) {
    throw new VoicevoxError("Failed to get speakers", response.status);
  }

  return response.json();
}

/**
 * Find speaker ID by name (e.g., "四国めたん")
 */
export async function findSpeakerByName(
  name: string,
  styleName?: string
): Promise<number | null> {
  const speakers = await getSpeakers();

  for (const speaker of speakers) {
    if (speaker.name.includes(name)) {
      if (styleName) {
        const style = speaker.styles.find((s) => s.name.includes(styleName));
        if (style) return style.id;
      }
      // Return first style if no specific style requested
      if (speaker.styles.length > 0) {
        return speaker.styles[0].id;
      }
    }
  }

  return null;
}

/**
 * Initialize VOICEVOX and load saved speaker or find default
 */
export async function initializeVoicevox(): Promise<{
  available: boolean;
  speakerId: number;
  speakerName: string;
}> {
  const available = await checkVoicevoxStatus();

  if (!available) {
    return {
      available: false,
      speakerId: defaultSpeakerId,
      speakerName: "Unknown",
    };
  }

  // Check for saved speaker preference
  const savedId = loadSavedSpeakerId();
  if (savedId !== null) {
    // Verify the saved speaker still exists
    const speakers = await getSpeakers();
    for (const speaker of speakers) {
      for (const style of speaker.styles) {
        if (style.id === savedId) {
          defaultSpeakerId = savedId;
          return {
            available: true,
            speakerId: savedId,
            speakerName: `${speaker.name} (${style.name})`,
          };
        }
      }
    }
  }

  // Try to find Shikoku Metan as default
  const metanId = await findSpeakerByName("四国めたん", "ノーマル");
  if (metanId !== null) {
    defaultSpeakerId = metanId;
    saveSpeakerId(metanId);
    return {
      available: true,
      speakerId: metanId,
      speakerName: "四国めたん (ノーマル)",
    };
  }

  // Fall back to first available speaker
  const speakers = await getSpeakers();
  if (speakers.length > 0 && speakers[0].styles.length > 0) {
    defaultSpeakerId = speakers[0].styles[0].id;
    saveSpeakerId(defaultSpeakerId);
    return {
      available: true,
      speakerId: defaultSpeakerId,
      speakerName: `${speakers[0].name} (${speakers[0].styles[0].name})`,
    };
  }

  return {
    available: true,
    speakerId: defaultSpeakerId,
    speakerName: "Default",
  };
}

/**
 * Generate audio query for text
 */
async function createAudioQuery(
  text: string,
  speakerId: number
): Promise<object> {
  const params = new URLSearchParams({
    text,
    speaker: speakerId.toString(),
  });

  const response = await fetch(
    `${VOICEVOX_BASE_URL}/audio_query?${params.toString()}`,
    {
      method: "POST",
    }
  );

  if (!response.ok) {
    throw new VoicevoxError("Failed to create audio query", response.status);
  }

  return response.json();
}

/**
 * Synthesize audio from query
 */
async function synthesizeFromQuery(
  query: object,
  speakerId: number
): Promise<ArrayBuffer> {
  const params = new URLSearchParams({
    speaker: speakerId.toString(),
  });

  const response = await fetch(
    `${VOICEVOX_BASE_URL}/synthesis?${params.toString()}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(query),
    }
  );

  if (!response.ok) {
    throw new VoicevoxError("Failed to synthesize audio", response.status);
  }

  return response.arrayBuffer();
}

/**
 * Synthesize speech from text
 */
export async function synthesize(
  text: string,
  speakerId?: number
): Promise<ArrayBuffer> {
  const id = speakerId ?? defaultSpeakerId;
  const query = await createAudioQuery(text, id);
  return synthesizeFromQuery(query, id);
}

/**
 * Options for audio playback with visualization
 */
export interface PlayAudioOptions {
  /** Callback fired with amplitude values (0-1) during playback */
  onAmplitude?: (amplitude: number) => void;
  /** How often to sample amplitude in ms (default: 50) */
  amplitudeSampleRate?: number;
}

/**
 * Play audio data through Web Audio API with optional amplitude analysis
 */
export async function playAudio(
  audioData: ArrayBuffer,
  options?: PlayAudioOptions
): Promise<void> {
  const audioContext = getAudioContext();

  // Resume context if suspended (browser autoplay policy)
  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }

  // VOICEVOX outputs 24kHz WAV, which might need handling
  const audioBuffer = await audioContext.decodeAudioData(audioData.slice(0));

  const source = audioContext.createBufferSource();
  source.buffer = audioBuffer;

  // Store reference for potential interruption
  currentSource = source;
  isCurrentlyPlaying = true;

  // Set up analyzer if amplitude callback provided
  let analyser: AnalyserNode | null = null;
  let amplitudeInterval: ReturnType<typeof setInterval> | null = null;

  if (options?.onAmplitude) {
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;

    source.connect(analyser);
    analyser.connect(audioContext.destination);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const sampleRate = options.amplitudeSampleRate ?? 50;

    amplitudeInterval = setInterval(() => {
      if (analyser) {
        analyser.getByteFrequencyData(dataArray);
        // Calculate average amplitude (0-255) and normalize to 0-1
        const sum = dataArray.reduce((a, b) => a + b, 0);
        const average = sum / dataArray.length;
        const normalized = Math.min(average / 128, 1); // Normalize with some headroom
        options.onAmplitude!(normalized);
      }
    }, sampleRate);
  } else {
    source.connect(audioContext.destination);
  }

  return new Promise((resolve) => {
    source.onended = () => {
      if (amplitudeInterval) {
        clearInterval(amplitudeInterval);
        options?.onAmplitude?.(0); // Reset amplitude when done
      }
      currentSource = null;
      isCurrentlyPlaying = false;
      resolve();
    };
    source.start();
  });
}

/**
 * Stop currently playing audio (for interruption)
 */
export function stopCurrentAudio(): void {
  if (currentSource && isCurrentlyPlaying) {
    try {
      currentSource.stop();
    } catch {
      // Already stopped
    }
    currentSource = null;
    isCurrentlyPlaying = false;
  }
}

/**
 * Check if audio is currently playing
 */
export function isPlaying(): boolean {
  return isCurrentlyPlaying;
}

/**
 * Options for speak function
 */
export interface SpeakOptions {
  speakerId?: number;
  /** Callback fired with amplitude values (0-1) during speech */
  onAmplitude?: (amplitude: number) => void;
}

/**
 * Speak text using VOICEVOX (synthesize + play)
 */
export async function speak(
  text: string,
  optionsOrSpeakerId?: SpeakOptions | number
): Promise<void> {
  // Handle backward compatibility with old signature
  const options: SpeakOptions =
    typeof optionsOrSpeakerId === "number"
      ? { speakerId: optionsOrSpeakerId }
      : optionsOrSpeakerId ?? {};

  const audioData = await synthesize(text, options.speakerId);
  await playAudio(audioData, { onAmplitude: options.onAmplitude });
}

/**
 * Get the current default speaker ID
 */
export function getDefaultSpeakerId(): number {
  return defaultSpeakerId;
}

/**
 * Set the default speaker ID and save to localStorage
 */
export function setDefaultSpeakerId(id: number): void {
  defaultSpeakerId = id;
  saveSpeakerId(id);
}

/**
 * Get all available speakers with their styles flattened for easy selection
 */
export async function getAllVoiceOptions(): Promise<
  Array<{ id: number; name: string; speakerName: string; styleName: string }>
> {
  const speakers = await getSpeakers();
  const options: Array<{
    id: number;
    name: string;
    speakerName: string;
    styleName: string;
  }> = [];

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
