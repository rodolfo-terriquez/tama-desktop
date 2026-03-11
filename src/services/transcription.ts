import { transcribeAudioLocal } from "./whisper-local";
import { transcribeAudio as transcribeAudioOpenAI, type TranscribeOptions } from "./openai";
import { blobToFloat32PCM } from "./audio-utils";

const ENGINE_KEY = "tama_transcription_engine";

export type TranscriptionEngine = "local" | "openai";

export function getTranscriptionEngine(): TranscriptionEngine {
  return (localStorage.getItem(ENGINE_KEY) as TranscriptionEngine) || "local";
}

export function setTranscriptionEngine(engine: TranscriptionEngine): void {
  localStorage.setItem(ENGINE_KEY, engine);
  window.dispatchEvent(new Event("tama-config-changed"));
}

/**
 * Transcribe audio using the currently selected engine.
 * Accepts either a Float32Array (16 kHz mono PCM, from Silero VAD) or a Blob.
 */
export async function transcribeAudio(
  audio: Float32Array | Blob,
  options: TranscribeOptions = {}
): Promise<string> {
  const engine = getTranscriptionEngine();

  if (engine === "local") {
    const pcm = audio instanceof Float32Array
      ? audio
      : await blobToFloat32PCM(audio);
    return transcribeAudioLocal(pcm, {
      language: options.language ?? "ja",
    });
  }

  // OpenAI API expects a Blob — copy to a plain ArrayBuffer to satisfy BlobPart
  if (audio instanceof Blob) {
    return transcribeAudioOpenAI(audio, options);
  }
  const buf = new ArrayBuffer(audio.byteLength);
  new Float32Array(buf).set(audio);
  return transcribeAudioOpenAI(new Blob([buf], { type: "audio/wav" }), options);
}
