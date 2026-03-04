import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

interface UseVADRecorderOptions {
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
  start: () => Promise<void>;
  stop: () => Promise<void>;
  pause: () => void;
  resume: () => void;
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

  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPausedRef = useRef(false);
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

  const removeListeners = useCallback(async () => {
    for (const unlisten of unlistenersRef.current) {
      unlisten();
    }
    unlistenersRef.current = [];
  }, []);

  const start = useCallback(async () => {
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
          if (!isPausedRef.current) {
            onSpeechEndRef.current?.();
          }
        })
      );

      unlisteners.push(
        await listen<{ text: string }>("voice-transcription", (event) => {
          // Rust guarantees this is never emitted for audio captured while paused,
          // so no JS-side filter needed here.
          onTranscriptionRef.current?.(event.payload.text);
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

      await invoke("start_voice_session");

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
  }, [isListening, removeListeners]);

  const stop = useCallback(async () => {
    try {
      await invoke("stop_voice_session");
    } catch (err) {
      console.error("Error stopping voice session:", err);
    }
    await removeListeners();
    isPausedRef.current = false;
    setIsListening(false);
    setIsSpeaking(false);
  }, [removeListeners]);

  const pause = useCallback(() => {
    isPausedRef.current = true;
    setIsSpeaking(false);
    onAmplitudeRef.current?.(0);
    // Tell Rust to discard all audio — the only reliable way to prevent
    // TTS audio feedback from being captured and transcribed
    invoke("pause_voice_session").catch(() => {});
  }, []);

  const resume = useCallback(() => {
    isPausedRef.current = false;
    invoke("resume_voice_session").catch(() => {});
  }, []);

  useEffect(() => {
    return () => {
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
  };
}
