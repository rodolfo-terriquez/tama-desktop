import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { base64ToFloat32PCM } from "@/services/audio-utils";
import { transcribeAudio, getTranscriptionEngine } from "@/services/transcription";
import type { VoiceInputMode } from "@/services/voice-input";

interface UseVADRecorderOptions {
  recordingMode?: VoiceInputMode;
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
  onTranscription?: (text: string) => void;
  onAmplitude?: (amplitude: number) => void;
  onError?: (message: string) => void;
}

interface UseVADRecorderReturn {
  isListening: boolean;
  isSpeaking: boolean;
  isSupported: boolean;
  isLoading: boolean;
  error: string | null;
  start: (options?: { requireWhisperLoaded?: boolean }) => Promise<void>;
  stop: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  isPushToTalkActive: boolean;
  isPushToTalkFinalizing: boolean;
  beginPushToTalk: () => Promise<void>;
  endPushToTalk: () => Promise<void>;
}

interface AudioSegmentPayload {
  audioBase64: string;
  sampleRate: number;
}

/**
 * Voice activity detection powered by Rust-native cpal + Silero VAD.
 * No browser audio APIs -- all capture and detection happens in the Rust backend.
 */
export function useVADRecorder(
  options: UseVADRecorderOptions = {}
): UseVADRecorderReturn {
  const { onSpeechStart, onSpeechEnd, onTranscription, onAmplitude, onError } =
    options;
  const recordingMode = options.recordingMode ?? "automatic";

  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPushToTalkActive, setIsPushToTalkActive] = useState(false);
  const [isPushToTalkFinalizing, setIsPushToTalkFinalizing] = useState(false);

  const isPausedRef = useRef(false);
  const isPushToTalkActiveRef = useRef(false);
  const pushToTalkCommandRef = useRef<Promise<void>>(Promise.resolve());
  const pushToTalkFinalizingTimeoutRef = useRef<number | null>(null);
  const unlistenersRef = useRef<UnlistenFn[]>([]);

  const onSpeechStartRef = useRef(onSpeechStart);
  const onSpeechEndRef = useRef(onSpeechEnd);
  const onTranscriptionRef = useRef(onTranscription);
  const onAmplitudeRef = useRef(onAmplitude);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onSpeechStartRef.current = onSpeechStart;
    onSpeechEndRef.current = onSpeechEnd;
    onTranscriptionRef.current = onTranscription;
    onAmplitudeRef.current = onAmplitude;
    onErrorRef.current = onError;
  }, [onSpeechStart, onSpeechEnd, onTranscription, onAmplitude, onError]);

  const clearPushToTalkFinalizing = useCallback(() => {
    if (pushToTalkFinalizingTimeoutRef.current !== null) {
      window.clearTimeout(pushToTalkFinalizingTimeoutRef.current);
      pushToTalkFinalizingTimeoutRef.current = null;
    }
    setIsPushToTalkFinalizing(false);
  }, []);

  const removeListeners = useCallback(async () => {
    for (const unlisten of unlistenersRef.current) {
      unlisten();
    }
    unlistenersRef.current = [];
  }, []);

  const start = useCallback(async (options?: { requireWhisperLoaded?: boolean }) => {
    if (isListening) return;
    setIsLoading(true);
    setError(null);

    try {
      const unlisteners: UnlistenFn[] = [];

      unlisteners.push(
        await listen("voice-speech-start", () => {
          if (!isPausedRef.current) {
            setIsSpeaking(true);
            onSpeechStartRef.current?.();
          }
        })
      );

      unlisteners.push(
        await listen("voice-speech-end", () => {
          setIsSpeaking(false);
          clearPushToTalkFinalizing();
          if (!isPausedRef.current) {
            onSpeechEndRef.current?.();
          }
        })
      );

      unlisteners.push(
        await listen("voice-speech-cancelled", () => {
          setIsSpeaking(false);
          clearPushToTalkFinalizing();
          onAmplitudeRef.current?.(0);
        })
      );

      unlisteners.push(
        await listen<AudioSegmentPayload>("voice-audio-segment", (event) => {
          void (async () => {
            try {
              const pcm = base64ToFloat32PCM(event.payload.audioBase64);
              const text = await transcribeAudio(pcm, { language: "ja" });
              if (text) {
                onTranscriptionRef.current?.(text);
              }
            } catch (err) {
              const message =
                err instanceof Error ? err.message : "Failed to transcribe audio";
              setError(message);
              onErrorRef.current?.(message);
            }
          })();
        })
      );

      unlisteners.push(
        await listen<{ level: number }>("voice-amplitude", (event) => {
          if (!isPausedRef.current) {
            onAmplitudeRef.current?.(event.payload.level);
          }
        })
      );

      unlisteners.push(
        await listen<{ message: string }>("voice-error", (event) => {
          setError(event.payload.message);
          onErrorRef.current?.(event.payload.message);
        })
      );

      unlistenersRef.current = unlisteners;

      const requireWhisperLoaded =
        options?.requireWhisperLoaded ??
        getTranscriptionEngine() === "local";
      await invoke("start_voice_session", {
        requireWhisperLoaded,
        recordingMode,
      });

      isPausedRef.current = false;
      setIsListening(true);
    } catch (err) {
      console.error("Failed to start voice session:", err);
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      await removeListeners();
    } finally {
      setIsLoading(false);
    }
  }, [clearPushToTalkFinalizing, isListening, recordingMode, removeListeners]);

  const queuePushToTalkCommand = useCallback((command: string) => {
    const queued = pushToTalkCommandRef.current.then(() => invoke<void>(command));
    pushToTalkCommandRef.current = queued.catch(() => {});
    return queued;
  }, []);

  const beginPushToTalk = useCallback(async () => {
    if (
      recordingMode !== "push-to-talk" ||
      !isListening ||
      isPushToTalkActiveRef.current ||
      isPushToTalkFinalizing
    ) {
      return;
    }

    isPushToTalkActiveRef.current = true;
    setIsPushToTalkActive(true);
    setError(null);

    try {
      await queuePushToTalkCommand("begin_push_to_talk");
    } catch (err) {
      isPushToTalkActiveRef.current = false;
      setIsPushToTalkActive(false);
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      onErrorRef.current?.(message);
    }
  }, [isListening, isPushToTalkFinalizing, queuePushToTalkCommand, recordingMode]);

  const endPushToTalk = useCallback(async () => {
    if (recordingMode !== "push-to-talk" || !isPushToTalkActiveRef.current) {
      return;
    }

    isPushToTalkActiveRef.current = false;
    setIsPushToTalkActive(false);
    setIsPushToTalkFinalizing(true);
    pushToTalkFinalizingTimeoutRef.current = window.setTimeout(() => {
      pushToTalkFinalizingTimeoutRef.current = null;
      setIsPushToTalkFinalizing(false);
    }, 1500);

    try {
      await queuePushToTalkCommand("end_push_to_talk");
    } catch (err) {
      clearPushToTalkFinalizing();
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      onErrorRef.current?.(message);
    }
  }, [clearPushToTalkFinalizing, queuePushToTalkCommand, recordingMode]);

  const stop = useCallback(async () => {
    try {
      await invoke("stop_voice_session");
    } catch (err) {
      console.error("Error stopping voice session:", err);
    }
    await removeListeners();
    isPausedRef.current = false;
    isPushToTalkActiveRef.current = false;
    setIsPushToTalkActive(false);
    clearPushToTalkFinalizing();
    setIsListening(false);
    setIsSpeaking(false);
  }, [clearPushToTalkFinalizing, removeListeners]);

  const pause = useCallback(() => {
    isPausedRef.current = true;
    isPushToTalkActiveRef.current = false;
    setIsPushToTalkActive(false);
    clearPushToTalkFinalizing();
    setIsSpeaking(false);
    onAmplitudeRef.current?.(0);
    // Tell Rust to discard all audio — the only reliable way to prevent
    // TTS audio feedback from being captured and transcribed
    invoke("pause_voice_session").catch(() => {});
  }, [clearPushToTalkFinalizing]);

  const resume = useCallback(() => {
    isPausedRef.current = false;
    invoke("resume_voice_session").catch(() => {});
  }, []);

  useEffect(() => {
    return () => {
      if (pushToTalkFinalizingTimeoutRef.current !== null) {
        window.clearTimeout(pushToTalkFinalizingTimeoutRef.current);
      }
      for (const unlisten of unlistenersRef.current) {
        unlisten();
      }
      invoke("stop_voice_session").catch(() => {});
    };
  }, []);

  return {
    isListening,
    isSpeaking,
    isSupported: true,
    isLoading,
    error,
    start,
    stop,
    pause,
    resume,
    isPushToTalkActive,
    isPushToTalkFinalizing,
    beginPushToTalk,
    endPushToTalk,
  };
}
