import { useEffect, useRef } from "react";

interface VoiceVisualizerProps {
  /** Current amplitude value (0-1) */
  amplitude: number;
  /** Whether the AI is currently speaking */
  isSpeaking: boolean;
  /** Whether the system is listening for user input */
  isListening: boolean;
  /** Whether the user is actively speaking (voice detected) */
  isUserSpeaking?: boolean;
  /** Whether processing is happening */
  isProcessing: boolean;
  /** Size of the visualizer in pixels */
  size?: number;
}

export function VoiceVisualizer({
  amplitude,
  isSpeaking,
  isListening,
  isUserSpeaking = false,
  isProcessing,
  size = 200,
}: VoiceVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const smoothedAmplitude = useRef(0);

  // Add padding to canvas to accommodate glow rings
  const padding = size * 0.4; // 40% padding on each side
  const canvasSize = size + padding * 2;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size with device pixel ratio for sharpness
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasSize * dpr;
    canvas.height = canvasSize * dpr;
    ctx.scale(dpr, dpr);

    const centerX = canvasSize / 2;
    const centerY = canvasSize / 2;
    const baseRadius = size * 0.3;

    const draw = () => {
      if (!ctx) return;

      // Smooth amplitude transitions
      const targetAmplitude = isSpeaking || isListening || isUserSpeaking ? amplitude : 0;
      smoothedAmplitude.current +=
        (targetAmplitude - smoothedAmplitude.current) * 0.15;

      // Clear canvas
      ctx.clearRect(0, 0, canvasSize, canvasSize);

      // Calculate dynamic radius based on amplitude
      const amplitudeScale = 1 + smoothedAmplitude.current * 0.5;
      const radius = baseRadius * amplitudeScale;

      // Determine colors based on state
      let primaryColor: string;
      let glowColor: string;
      let pulseIntensity = 0;

      if (isProcessing) {
        // Processing state - subtle pulsing amber
        primaryColor = "rgba(245, 158, 11, 0.9)";
        glowColor = "rgba(245, 158, 11, 0.3)";
        pulseIntensity = 0.3;
      } else if (isSpeaking) {
        // AI speaking - vibrant blue/purple
        primaryColor = "rgba(99, 102, 241, 0.95)";
        glowColor = "rgba(99, 102, 241, 0.4)";
        pulseIntensity = smoothedAmplitude.current;
      } else if (isUserSpeaking) {
        // User actively speaking - bright green
        primaryColor = "rgba(34, 197, 94, 0.95)";
        glowColor = "rgba(34, 197, 94, 0.5)";
        pulseIntensity = smoothedAmplitude.current * 1.2;
      } else if (isListening) {
        // Listening but user not speaking - subtle teal, shows mic input
        primaryColor = "rgba(20, 184, 166, 0.7)";
        glowColor = "rgba(20, 184, 166, 0.3)";
        pulseIntensity = smoothedAmplitude.current * 0.5;
      } else {
        // Idle state - subtle gray
        primaryColor = "rgba(148, 163, 184, 0.6)";
        glowColor = "rgba(148, 163, 184, 0.2)";
        pulseIntensity = 0.1;
      }

      // Draw outer glow rings
      const numRings = 3;
      for (let i = numRings; i >= 1; i--) {
        const ringRadius = radius + i * 15 * (1 + pulseIntensity * 0.5);
        const alpha = (0.15 - i * 0.04) * (1 + pulseIntensity);

        ctx.beginPath();
        ctx.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
        ctx.fillStyle = glowColor.replace(/[\d.]+\)$/, `${alpha})`);
        ctx.fill();
      }

      // Draw main circle with gradient
      const gradient = ctx.createRadialGradient(
        centerX - radius * 0.3,
        centerY - radius * 0.3,
        0,
        centerX,
        centerY,
        radius
      );
      gradient.addColorStop(0, primaryColor.replace(/[\d.]+\)$/, "1)"));
      gradient.addColorStop(0.7, primaryColor);
      gradient.addColorStop(1, primaryColor.replace(/[\d.]+\)$/, "0.7)"));

      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();

      // Add subtle inner highlight
      const highlightGradient = ctx.createRadialGradient(
        centerX - radius * 0.4,
        centerY - radius * 0.4,
        0,
        centerX,
        centerY,
        radius * 0.8
      );
      highlightGradient.addColorStop(0, "rgba(255, 255, 255, 0.3)");
      highlightGradient.addColorStop(0.5, "rgba(255, 255, 255, 0.1)");
      highlightGradient.addColorStop(1, "rgba(255, 255, 255, 0)");

      ctx.beginPath();
      ctx.arc(centerX, centerY, radius * 0.9, 0, Math.PI * 2);
      ctx.fillStyle = highlightGradient;
      ctx.fill();

      // Processing spinner overlay
      if (isProcessing) {
        const time = Date.now() / 1000;
        const spinnerRadius = radius * 1.2;

        ctx.strokeStyle = "rgba(245, 158, 11, 0.6)";
        ctx.lineWidth = 3;
        ctx.lineCap = "round";

        const arcLength = Math.PI * 0.5;
        const startAngle = time * 3;

        ctx.beginPath();
        ctx.arc(centerX, centerY, spinnerRadius, startAngle, startAngle + arcLength);
        ctx.stroke();
      }

      animationRef.current = requestAnimationFrame(draw);
    }

    draw();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [size, canvasSize, amplitude, isSpeaking, isListening, isUserSpeaking, isProcessing]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: canvasSize,
        height: canvasSize,
        // Negative margin to maintain visual positioning as if it were the original size
        margin: -padding,
      }}
      className="transition-transform duration-300"
    />
  );
}
