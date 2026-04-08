import { useMemo } from "react";

interface VoiceVisualizerProps {
  amplitude: number;
  isSpeaking: boolean;
  isListening: boolean;
  isUserSpeaking?: boolean;
  isProcessing: boolean;
  size?: number;
  blur?: number;
}

interface StateStyle {
  color: string;
  glow: string;
}

const STYLES: Record<string, StateStyle> = {
  processing: {
    color: "#D58AC8",
    glow: "color-mix(in srgb, #D58AC8 45%, transparent)",
  },
  userSpeaking: {
    color: "#789BE8",
    glow: "color-mix(in srgb, #789BE8 45%, transparent)",
  },
  aiSpeaking: {
    color: "#BD7CDA",
    glow: "color-mix(in srgb, #BD7CDA 40%, transparent)",
  },
  listening: {
    color: "#D3B8EA",
    glow: "color-mix(in srgb, #D3B8EA 35%, transparent)",
  },
  idle: {
    color: "var(--neutral)",
    glow: "color-mix(in srgb, var(--neutral) 20%, transparent)",
  },
};

export function VoiceVisualizer({
  amplitude,
  isSpeaking,
  isListening,
  isUserSpeaking = false,
  isProcessing,
  size = 120,
  blur = 0,
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
        background: `radial-gradient(circle at center, ${style.color} 0%, ${style.color} 54%, color-mix(in srgb, ${style.color} 72%, transparent) 72%, transparent 100%)`,
        transform: `scale(${scale})`,
        boxShadow: `0 0 ${glowSpread}px ${glowSpread / 2}px ${style.glow}`,
        filter: blur > 0 ? `blur(${blur}px)` : "none",
        transition: "transform 150ms ease-out, background 350ms ease, box-shadow 350ms ease, width 700ms cubic-bezier(0.22, 1, 0.36, 1), height 700ms cubic-bezier(0.22, 1, 0.36, 1), filter 700ms cubic-bezier(0.22, 1, 0.36, 1)",
        animation: isProcessing ? "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite" : "none",
        willChange: "transform, width, height, filter, box-shadow",
      }}
    />
  );
}
