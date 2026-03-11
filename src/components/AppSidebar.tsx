import { useState, useEffect, useCallback } from "react";
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
import { Settings, BookOpen, Home, Library, History, Users, ChartColumn } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { getStoredEngineType, getEngine, getDefaultVoiceId, getAllVoiceOptions } from "@/services/tts";
import type { TTSEngineType } from "@/services/tts";
import { getLLMProvider, getOpenRouterModel, hasApiKey } from "@/services/claude";
import { hasOpenAIApiKey } from "@/services/openai";
import { getTranscriptionEngine } from "@/services/transcription";

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
  const [engineType, setEngineType] = useState<TTSEngineType>(getStoredEngineType);
  const [ttsStatus, setTtsStatus] = useState<"checking" | "online" | "offline">("checking");
  const [voiceName, setVoiceName] = useState<string>("");

  const check = useCallback(async () => {
    setTtsStatus("checking");
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
  }, [engineType]);

  useEffect(() => {
    check();
    const interval = setInterval(check, 30_000);

    const onEngineChanged = () => {
      setEngineType(getStoredEngineType());
    };
    const onConfigChanged = () => {
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
  const transcriptionEngine = getTranscriptionEngine();
  const sttLabel = transcriptionEngine === "local" ? "Local Whisper" : "OpenAI Whisper";

  const hasLLMKey = hasApiKey();
  const hasSTTConfig =
    transcriptionEngine === "local"
      ? true
      : hasOpenAIApiKey();

  let dotColor: DotColor;
  const issues: string[] = [];

  if (ttsStatus === "checking") {
    dotColor = "pulse";
  } else if (!hasLLMKey || !hasSTTConfig) {
    dotColor = "red";
    if (!hasLLMKey) issues.push("LLM API key missing");
    if (!hasSTTConfig) issues.push("OpenAI key missing for transcription");
  } else if (ttsStatus === "offline") {
    dotColor = "gray";
    issues.push(`${ttsLabel} is off`);
  } else {
    dotColor = "green";
  }

  const tooltipLines = [
    `LLM: ${llmModel} ${hasLLMKey ? "✓" : "✗"}`,
    `STT: ${sttLabel} ${hasSTTConfig ? "✓" : "✗"}`,
    `TTS: ${ttsLabel} ${ttsStatus === "online" ? "✓" : ttsStatus === "checking" ? "…" : "✗"}`,
    voiceName ? `Voice: ${voiceName}` : null,
    ...issues.map((i) => `⚠ ${i}`),
  ].filter(Boolean);

  const DOT_CLASSES: Record<DotColor, string> = {
    green: "bg-green-500",
    yellow: "bg-yellow-400",
    red: "bg-red-500",
    gray: "bg-gray-400",
    pulse: "bg-yellow-400 animate-pulse",
  };

  return { dotClass: DOT_CLASSES[dotColor], dotColor, tooltipLines };
}


export function AppSidebar({ currentScreen, onNavigate }: AppSidebarProps) {
  const { dotClass, dotColor, tooltipLines } = useStatusInfo();
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [appVersion, setAppVersion] = useState<string>("");
  const labelFadeClass =
    "group-data-[collapsible=icon]:[&>span:last-child]:opacity-0 [&>span:last-child]:transition-opacity [&>span:last-child]:duration-100";

  useEffect(() => {
    getVersion()
      .then((v) => setAppVersion(v))
      .catch(() => setAppVersion(""));
  }, []);

  const navItems = [
    {
      title: "Home",
      icon: Home,
      id: "home",
      isActive: currentScreen === "home",
    },
    {
      title: "Scenarios",
      icon: Library,
      id: "scenario-select",
      isActive: currentScreen === "scenario-select",
    },
    {
      title: "Personas",
      icon: Users,
      id: "ongoing-chats",
      isActive: currentScreen === "ongoing-chats" || currentScreen === "ongoing-chat",
    },
    {
      title: "Flashcards",
      icon: BookOpen,
      id: "flashcards",
      isActive: currentScreen === "flashcards",
    },
    {
      title: "History",
      icon: History,
      id: "history",
      isActive: currentScreen === "history",
    },
    {
      title: "Stats",
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
            <SidebarMenuButton
              isActive={currentScreen === "settings"}
              onClick={() => onNavigate("settings")}
              tooltip="Settings"
              className={labelFadeClass}
            >
              <Settings className="h-4 w-4" />
              <span className="flex w-full items-center justify-between gap-2">
                <span>Settings</span>
                {!isCollapsed && appVersion && (
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    v{appVersion}
                  </span>
                )}
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
