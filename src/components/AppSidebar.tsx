import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Settings, BookOpen, Home, Library, History, Users, ChartColumn, RefreshCw } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { getStoredEngineType, getEngine, getDefaultVoiceId, getAllVoiceOptions } from "@/services/tts";
import {
  checkForAppUpdatesManually,
  getAvailableAppUpdate,
  type AppUpdateCheckResult,
} from "@/services/updater";
import type { TTSEngineType } from "@/services/tts";
import { getLLMProvider, getOpenRouterModel, hasApiKey } from "@/services/claude";
import { hasOpenAIApiKey } from "@/services/openai";
import { getTranscriptionEngine } from "@/services/transcription";
import { getWhisperModelStatus } from "@/services/whisper-local";
import { useI18n } from "@/i18n";

interface AppSidebarProps {
  currentScreen: string;
  onNavigate: (screen: string) => void;
}

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
        } catch { /* ignore */ }
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
    }).then((fn) => { unlistenVoicevox = fn; });

    return () => {
      clearInterval(interval);
      window.removeEventListener("tts-engine-changed", onEngineChanged);
      window.removeEventListener("tama-config-changed", onConfigChanged);
      unlistenVoicevox?.();
    };
  }, [check]);

  const llmProvider = getLLMProvider();
  const llmModel = llmProvider === "openrouter"
    ? getOpenRouterModel()
    : "Claude (Anthropic)";
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


export function AppSidebar({ currentScreen, onNavigate }: AppSidebarProps) {
  const { t } = useI18n();
  const { dotClass, dotColor, tooltipLines } = useStatusInfo();
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [appVersion, setAppVersion] = useState<string>("");
  const [availableUpdateVersion, setAvailableUpdateVersion] = useState<string | null>(null);
  const [isCheckingForUpdates, setIsCheckingForUpdates] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const labelFadeClass =
    "group-data-[collapsible=icon]:[&>span:last-child]:opacity-0 [&>span:last-child]:transition-opacity [&>span:last-child]:duration-100";

  useEffect(() => {
    getVersion()
      .then((v) => setAppVersion(v))
      .catch(() => setAppVersion(""));
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadAvailableUpdate = async () => {
      const result = await getAvailableAppUpdate();
      if (cancelled) return;

      if (result.status === "available") {
        setAvailableUpdateVersion(result.version ?? null);
        return;
      }

      setAvailableUpdateVersion(null);
    };

    void loadAvailableUpdate();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!updateMessage) return;

    const timeoutId = window.setTimeout(() => {
      setUpdateMessage(null);
    }, 5000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [updateMessage]);

  const handleUpdateCheck = useCallback(async () => {
    if (isCheckingForUpdates) return;

    setIsCheckingForUpdates(true);
    setUpdateMessage(null);

    let result: AppUpdateCheckResult;
    try {
      result = await checkForAppUpdatesManually();
    } finally {
      setIsCheckingForUpdates(false);
    }

    switch (result.status) {
      case "disabled":
        setUpdateMessage({ type: "error", text: result.message ?? t("sidebar.updaterDisabled") });
        break;
      case "up-to-date":
        setAvailableUpdateVersion(null);
        setUpdateMessage({
          type: "success",
          text: appVersion ? t("sidebar.upToDateVersion", { version: appVersion }) : t("sidebar.upToDate"),
        });
        break;
      case "declined":
        setAvailableUpdateVersion(result.version ?? availableUpdateVersion);
        setUpdateMessage({
          type: "success",
          text: result.version
            ? t("sidebar.updateAvailableVersion", { version: result.version })
            : t("sidebar.updateAvailable"),
        });
        break;
      case "installed":
        setAvailableUpdateVersion(null);
        setUpdateMessage({
          type: "success",
          text: result.version
            ? t("sidebar.updateInstalledVersion", { version: result.version })
            : t("sidebar.updateInstalled"),
        });
        break;
      case "error":
        setUpdateMessage({
          type: "error",
          text: result.message
            ? t("sidebar.updateFailedWithMessage", { message: result.message })
            : t("sidebar.updateFailed"),
        });
        break;
      default:
        setUpdateMessage(null);
    }
  }, [appVersion, availableUpdateVersion, isCheckingForUpdates, t]);

  const navItems = [
    {
      title: t("common.home"),
      icon: Home,
      id: "home",
      isActive: currentScreen === "home",
    },
    {
      title: t("common.scenarios"),
      icon: Library,
      id: "scenario-select",
      isActive: currentScreen === "scenario-select",
    },
    {
      title: t("common.personas"),
      icon: Users,
      id: "ongoing-chats",
      isActive: currentScreen === "ongoing-chats" || currentScreen === "ongoing-chat",
    },
    {
      title: t("common.flashcards"),
      icon: BookOpen,
      id: "flashcards",
      isActive: currentScreen === "flashcards",
    },
    {
      title: t("common.history"),
      icon: History,
      id: "history",
      isActive: currentScreen === "history",
    },
    {
      title: t("common.stats"),
      icon: ChartColumn,
      id: "stats",
      isActive: currentScreen === "stats",
    },
  ];

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-2">
        <div className="flex h-8 items-center gap-2">
          {isCollapsed ? (
            <SidebarTrigger className="size-8" />
          ) : (
            <>
              <h1 className="text-xl font-bold">Tama</h1>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    role={dotColor !== "green" ? "button" : undefined}
                    tabIndex={dotColor !== "green" ? 0 : undefined}
                    onClick={dotColor !== "green" ? () => onNavigate("settings") : undefined}
                    className={`h-2 w-2 shrink-0 rounded-full ${dotClass} ${
                      dotColor !== "green" ? "cursor-pointer" : "cursor-default"
                    }`}
                  />
                </TooltipTrigger>
                <TooltipContent side="right" className="text-xs space-y-0.5">
                  {tooltipLines.map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                </TooltipContent>
              </Tooltip>
              <SidebarTrigger className="ml-auto" />
            </>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="p-2">
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {navItems.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    isActive={item.isActive}
                    onClick={() => onNavigate(item.id)}
                tooltip={item.title}
                className={labelFadeClass}
              >
                    <item.icon className="h-4 w-4" />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

      </SidebarContent>

      <SidebarFooter className="p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex items-center gap-1">
              <SidebarMenuButton
                isActive={currentScreen === "settings"}
                onClick={() => onNavigate("settings")}
                tooltip={t("common.settings")}
                className={`min-w-0 flex-1 ${labelFadeClass}`}
              >
                <Settings className="h-4 w-4" />
                <span className="flex w-full min-w-0 items-center justify-between gap-2">
                  <span>{t("common.settings")}</span>
                  {!isCollapsed && appVersion && (
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      v{appVersion}
                    </span>
                  )}
                </span>
              </SidebarMenuButton>
              {!isCollapsed && (
                availableUpdateVersion && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        onClick={handleUpdateCheck}
                        disabled={isCheckingForUpdates}
                        className="shrink-0"
                      >
                        <RefreshCw className={isCheckingForUpdates ? "animate-spin" : ""} />
                        <span>{isCheckingForUpdates ? t("sidebar.checking") : t("sidebar.update")}</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      {t("sidebar.installUpdate", { version: availableUpdateVersion })}
                    </TooltipContent>
                  </Tooltip>
                )
              )}
            </div>
            {!isCollapsed && updateMessage && (
              <p
                className={`mt-1 px-2 text-[11px] leading-relaxed ${
                  updateMessage.type === "error" ? "text-destructive" : "text-muted-foreground"
                }`}
              >
                {updateMessage.text}
              </p>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
