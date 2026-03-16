import { useState, useEffect, useCallback } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { listen } from "@tauri-apps/api/event";
import { getLLMProvider, getOpenRouterModel, hasApiKey } from "@/services/claude";
import { hasOpenAIApiKey } from "@/services/openai";
import { getTranscriptionEngine } from "@/services/transcription";
import { getStoredEngineType, getEngine, getDefaultVoiceId, getAllVoiceOptions } from "@/services/tts";
import type { TTSEngineType } from "@/services/tts";
import { getWhisperModelStatus } from "@/services/whisper-local";
import { useI18n } from "@/i18n";

const ENGINE_LABELS: Record<TTSEngineType, string> = {
  voicevox: "VOICEVOX",
  sbv2: "Style-Bert-VITS2",
};

type DotColor = "green" | "yellow" | "red" | "gray" | "pulse";

function useStatusInfo() {
  const { t } = useI18n();
  const [engineType, setEngineType] = useState<TTSEngineType>(getStoredEngineType);
  const [transcriptionEngine, setTranscriptionEngine] = useState(getTranscriptionEngine);
  const [ttsStatus, setTtsStatus] = useState<"checking" | "online" | "offline">("checking");
  const [voiceName, setVoiceName] = useState<string>("");
  const [sttReady, setSttReady] = useState<boolean | null>(null);

  const check = useCallback(async () => {
    setTtsStatus("checking");
    setTranscriptionEngine(getTranscriptionEngine());

    try {
      const engine = getEngine(engineType);
      const ok = await engine.checkStatus();
      setTtsStatus(ok ? "online" : "offline");

      if (ok) {
        try {
          const voices = await getAllVoiceOptions();
          const id = getDefaultVoiceId();
          const voice = voices.find((v) => v.id === id);
          setVoiceName(voice ? voice.name : "");
        } catch {
          // ignore voice lookup issues in the status badge
        }
      }
    } catch {
      setTtsStatus("offline");
    }

    try {
      const nextEngine = getTranscriptionEngine();
      if (nextEngine === "local") {
        const whisperStatus = await getWhisperModelStatus();
        setSttReady(whisperStatus.loaded);
      } else {
        setSttReady(hasOpenAIApiKey());
      }
    } catch {
      setSttReady(false);
    }
  }, [engineType]);

  useEffect(() => {
    check();
    const interval = setInterval(check, 30_000);

    const onEngineChanged = () => {
      setEngineType(getStoredEngineType());
    };
    const onConfigChanged = () => {
      setTranscriptionEngine(getTranscriptionEngine());
      check();
    };

    window.addEventListener("tts-engine-changed", onEngineChanged);
    window.addEventListener("tama-config-changed", onConfigChanged);

    let unlistenVoicevox: (() => void) | undefined;
    listen("voicevox-status-changed", () => {
      check();
    }).then((fn) => {
      unlistenVoicevox = fn;
    });

    return () => {
      clearInterval(interval);
      window.removeEventListener("tts-engine-changed", onEngineChanged);
      window.removeEventListener("tama-config-changed", onConfigChanged);
      unlistenVoicevox?.();
    };
  }, [check]);

  const llmProvider = getLLMProvider();
  const llmModel = llmProvider === "openrouter" ? getOpenRouterModel() : "Claude (Anthropic)";
  const ttsLabel = ENGINE_LABELS[engineType];
  const sttLabel = transcriptionEngine === "local" ? "Local Whisper" : "OpenAI Whisper";

  const hasLLMKey = hasApiKey();
  const hasSTTConfig = sttReady ?? false;

  let dotColor: DotColor;
  const issues: string[] = [];

  if (ttsStatus === "checking" || sttReady === null) {
    dotColor = "pulse";
  } else if (!hasLLMKey || !hasSTTConfig) {
    dotColor = "red";
    if (!hasLLMKey) issues.push(t("sidebar.issueMissingLlm"));
    if (!hasSTTConfig) {
      issues.push(
        transcriptionEngine === "local"
          ? t("sidebar.issueMissingLocalWhisper")
          : t("sidebar.issueMissingOpenAi")
      );
    }
  } else if (ttsStatus === "offline") {
    dotColor = "gray";
    issues.push(t("sidebar.issueTtsOff", { ttsLabel }));
  } else {
    dotColor = "green";
  }

  const tooltipLines = [
    `${t("sidebar.llm")}: ${llmModel} ${hasLLMKey ? "✓" : "✗"}`,
    `${t("sidebar.stt")}: ${sttLabel} ${hasSTTConfig ? "✓" : "✗"}`,
    `${t("sidebar.tts")}: ${ttsLabel} ${ttsStatus === "online" ? "✓" : ttsStatus === "checking" ? "…" : "✗"}`,
    voiceName ? `${t("sidebar.voice")}: ${voiceName}` : null,
    ...issues.map((i) => `⚠ ${i}`),
  ].filter(Boolean);

  const DOT_CLASSES: Record<DotColor, string> = {
    green: "bg-success",
    yellow: "bg-yellow-400",
    red: "bg-red-500",
    gray: "bg-gray-400",
    pulse: "bg-yellow-400 animate-pulse",
  };

  return { dotClass: DOT_CLASSES[dotColor], dotColor, tooltipLines };
}

export function AppStatusDot({
  onClick,
  className,
}: {
  onClick: () => void;
  className?: string;
}) {
  const { dotClass, dotColor, tooltipLines } = useStatusInfo();
  const isActionable = dotColor !== "green";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={isActionable ? onClick : undefined}
          className={cn(
            "h-2.5 w-2.5 rounded-full",
            dotClass,
            isActionable ? "cursor-pointer" : "cursor-default",
            className
          )}
          aria-label="App status"
        />
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end" className="text-xs space-y-0.5">
        {tooltipLines.map((line, index) => (
          <div key={index}>{line}</div>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}
