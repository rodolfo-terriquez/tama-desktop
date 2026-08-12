import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface WhisperModelStatus {
  loaded: boolean;
  model_exists: boolean;
  model_path: string;
  model_size_bytes: number;
  is_downloading: boolean;
}

export interface DownloadProgress {
  downloaded: number;
  total: number;
  percent: number;
}

export interface WhisperDiagnosticEntry {
  timestamp_ms: number;
  audio_duration_ms: number;
  processing_duration_ms: number;
  thread_count: number;
  logical_processor_count: number;
  backend: string;
  language: string;
  status: "success" | "error";
  error: string | null;
}

export async function getWhisperModelStatus(): Promise<WhisperModelStatus> {
  return invoke<WhisperModelStatus>("get_whisper_model_status");
}

export async function loadWhisperModel(
  onProgress?: (progress: DownloadProgress) => void
): Promise<void> {
  let unlisten: (() => void) | undefined;

  if (onProgress) {
    unlisten = await listen<DownloadProgress>(
      "whisper-download-progress",
      (event) => {
        onProgress(event.payload);
      }
    );
  }

  try {
    await invoke("load_whisper_model");
    window.dispatchEvent(new Event("tama-config-changed"));
  } finally {
    unlisten?.();
  }
}

export async function deleteWhisperModel(): Promise<void> {
  await invoke("delete_whisper_model");
  window.dispatchEvent(new Event("tama-config-changed"));
}

export async function getWhisperDiagnostics(): Promise<WhisperDiagnosticEntry[]> {
  return invoke<WhisperDiagnosticEntry[]>("get_whisper_diagnostics");
}

export async function clearWhisperDiagnostics(): Promise<void> {
  return invoke("clear_whisper_diagnostics");
}

function float32ToBase64(pcm: Float32Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Transcribe a Float32Array of 16 kHz mono PCM audio using local Whisper.
 */
export async function transcribeAudioLocal(
  pcm: Float32Array,
  options: { language?: string } = {}
): Promise<string> {
  const audioBase64 = float32ToBase64(pcm);
  return invoke<string>("transcribe_audio", {
    audioBase64,
    language: options.language ?? "ja",
  });
}
