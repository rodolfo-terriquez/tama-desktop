import { useMemo } from "react";

interface VoiceVisualizerProps {
  amplitude: number;
  isSpeaking: boolean;
  isListening: boolean;
  isUserSpeaking?: boolean;
  isProcessing: boolean;
  size?: number;
}

interface StateStyle {
  color: string;
  glow: string;
}

const STYLES: Record<string, StateStyle> = {
  processing: { color: "rgb(251, 191, 36)", glow: "rgba(251, 191, 36, 0.45)" },
  userSpeaking: { color: "rgb(74, 222, 128)", glow: "rgba(74, 222, 128, 0.45)" },
  aiSpeaking: { color: "rgb(129, 140, 248)", glow: "rgba(129, 140, 248, 0.4)" },
  listening: { color: "rgb(45, 212, 191)", glow: "rgba(45, 212, 191, 0.35)" },
  idle: { color: "rgb(209, 213, 219)", glow: "rgba(209, 213, 219, 0.2)" },
};

export function VoiceVisualizer({
  amplitude,
  isSpeaking,
  isListening,
  isUserSpeaking = false,
  isProcessing,
  size = 120,
}: VoiceVisualizerProps) {
  const style = useMemo(() => {
    if (isProcessing) return STYLES.processing;
    if (isUserSpeaking) return STYLES.userSpeaking;
    if (isSpeaking) return STYLES.aiSpeaking;
    if (isListening) return STYLES.listening;
    return STYLES.idle;
  }, [isSpeaking, isListening, isUserSpeaking, isProcessing]);

  const active = isSpeaking || isUserSpeaking || isListening;
  const scale = 1 + (active ? amplitude * 0.35 : 0);
  const glowSpread = Math.round(20 + (active ? amplitude * 30 : 0));

  return (
    <div
      role="status"
      aria-label={isProcessing ? "processing" : isSpeaking ? "ai speaking" : isUserSpeaking ? "user speaking" : isListening ? "listening" : "idle"}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        backgroundColor: style.color,
        transform: `scale(${scale})`,
        boxShadow: `0 0 ${glowSpread}px ${glowSpread / 2}px ${style.glow}`,
        transition: "transform 150ms ease-out, background-color 300ms ease, box-shadow 300ms ease",
        animation: isProcessing ? "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite" : "none",
      }}
    />
  );
}
