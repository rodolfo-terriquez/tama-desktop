import { useEffect, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import {
  getStoredEngineType,
  getStoredSpeechRate,
  MAX_SPEECH_RATE,
  MIN_SPEECH_RATE,
  setStoredSpeechRate,
  SPEECH_RATE_STEP,
} from "@/services/tts";

interface SpeechRateControlProps {
  className?: string;
  size?: "compact" | "settings";
}

export function SpeechRateControl({
  className = "",
  size = "compact",
}: SpeechRateControlProps) {
  const { t } = useI18n();
  const [engineType, setEngineType] = useState(getStoredEngineType);
  const [speechRate, setSpeechRate] = useState(getStoredSpeechRate);

  useEffect(() => {
    const refreshEngine = () => setEngineType(getStoredEngineType());
    const refreshSpeechRate = () => setSpeechRate(getStoredSpeechRate());

    window.addEventListener("tts-engine-changed", refreshEngine);
    window.addEventListener("tts-speech-rate-changed", refreshSpeechRate);
    return () => {
      window.removeEventListener("tts-engine-changed", refreshEngine);
      window.removeEventListener("tts-speech-rate-changed", refreshSpeechRate);
    };
  }, []);

  if (engineType !== "voicevox") return null;

  const isSettingsSize = size === "settings";

  const changeSpeechRate = (delta: number) => {
    setSpeechRate(setStoredSpeechRate(getStoredSpeechRate() + delta));
  };

  return (
    <div
      className={`inline-flex items-center rounded-lg border bg-background/80 ${
        isSettingsSize ? "p-px" : "p-0.5"
      } ${className}`}
      role="group"
      aria-label={t("settings.speechSpeed")}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={isSettingsSize ? "size-8" : "size-7"}
        disabled={speechRate <= MIN_SPEECH_RATE}
        onClick={() => changeSpeechRate(-SPEECH_RATE_STEP)}
        title={t("scenario.slowerSpeech")}
        aria-label={t("scenario.slowerSpeech")}
      >
        <Minus className="size-3.5" />
      </Button>
      <span
        className={`w-12 text-center font-medium tabular-nums ${
          isSettingsSize ? "text-sm" : "text-xs"
        }`}
        title={t("scenario.speechSpeed", { speed: speechRate.toFixed(1) })}
      >
        {speechRate.toFixed(1)}×
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={isSettingsSize ? "size-8" : "size-7"}
        disabled={speechRate >= MAX_SPEECH_RATE}
        onClick={() => changeSpeechRate(SPEECH_RATE_STEP)}
        title={t("scenario.fasterSpeech")}
        aria-label={t("scenario.fasterSpeech")}
      >
        <Plus className="size-3.5" />
      </Button>
    </div>
  );
}
