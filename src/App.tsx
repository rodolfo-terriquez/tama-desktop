import { Suspense, lazy, useEffect, useState } from "react";
import { ApiKeyDialog } from "@/components/ApiKeyDialog";
import { AppSidebar } from "@/components/AppSidebar";
import { SenseiSidebar } from "@/components/SenseiSidebar";
import { SidebarProvider, SidebarInset, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { hasApiKey } from "@/services/claude";
import { isApiOnboardingDismissed, setApiOnboardingDismissed } from "@/services/app-config";
import {
  buildFallbackSenseiViewContext,
  buildHomeSenseiViewContext,
  buildScenarioSelectSenseiViewContext,
} from "@/services/sensei-context";
import { checkForAppUpdatesOnLaunch } from "@/services/updater";
import { useI18n } from "@/i18n";
import type { AppScreen, Message, Scenario, SenseiViewContext } from "@/types";

type Screen = AppScreen;
type SenseiMode = "sidebar" | "full";
const SENSEI_MODE_STORAGE_KEY = "tama_sensei_mode";

const VoiceModeScreen = lazy(() =>
  import("@/components/conversation/VoiceModeScreen").then((m) => ({ default: m.VoiceModeScreen }))
);
const FeedbackScreen = lazy(() =>
  import("@/components/feedback/FeedbackScreen").then((m) => ({ default: m.FeedbackScreen }))
);
const FlashcardReview = lazy(() =>
  import("@/components/flashcard/FlashcardReview").then((m) => ({ default: m.FlashcardReview }))
);
const ScenarioPicker = lazy(() =>
  import("@/components/ScenarioPicker").then((m) => ({ default: m.ScenarioPicker }))
);
const HomeScreen = lazy(() =>
  import("@/components/HomeScreen").then((m) => ({ default: m.HomeScreen }))
);
const SessionHistory = lazy(() =>
  import("@/components/SessionHistory").then((m) => ({ default: m.SessionHistory }))
);
const StatsScreen = lazy(() =>
  import("@/components/StatsScreen").then((m) => ({ default: m.StatsScreen }))
);
const Settings = lazy(() =>
  import("@/components/Settings").then((m) => ({ default: m.Settings }))
);
const OngoingChatList = lazy(() =>
  import("@/components/ongoing/OngoingChatList").then((m) => ({ default: m.OngoingChatList }))
);
const OngoingChatScreen = lazy(() =>
  import("@/components/ongoing/OngoingChatScreen").then((m) => ({ default: m.OngoingChatScreen }))
);

function ScreenLoader() {
  const { t } = useI18n();
  return (
    <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
      {t("app.loading")}
    </div>
  );
}

function ExpandButton() {
  const { isMobile, openMobile } = useSidebar();
  if (!isMobile || openMobile) return null;
  return (
    <SidebarTrigger className="fixed top-2 left-2 z-50" />
  );
}

function App() {
  const { locale } = useI18n();
  const [needsApiKey, setNeedsApiKey] = useState(
    !hasApiKey() && !isApiOnboardingDismissed()
  );
  const [currentScreen, setCurrentScreen] = useState<Screen>("home");
  const [selectedScenario, setSelectedScenario] = useState<Scenario | null>(null);
  const [lastSession, setLastSession] = useState<{
    messages: Message[];
    scenario: Scenario;
  } | null>(null);
  const [selectedOngoingChatId, setSelectedOngoingChatId] = useState<string | null>(null);
  const [senseiOpen, setSenseiOpen] = useState(false);
  const [senseiMode, setSenseiMode] = useState<SenseiMode>(() => {
    const stored = localStorage.getItem(SENSEI_MODE_STORAGE_KEY);
    return stored === "full" ? "full" : "sidebar";
  });
  const [senseiReturnScreen, setSenseiReturnScreen] = useState<Exclude<Screen, "sensei">>("home");
  const [pendingSenseiPromptRequest, setPendingSenseiPromptRequest] = useState<{
    id: string;
    prompt: string;
  } | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [senseiViewContext, setSenseiViewContext] = useState<SenseiViewContext>(
    buildHomeSenseiViewContext()
  );

  useEffect(() => {
    void checkForAppUpdatesOnLaunch();
  }, []);

  useEffect(() => {
    localStorage.setItem(SENSEI_MODE_STORAGE_KEY, senseiMode);
  }, [senseiMode]);

  useEffect(() => {
    const syncApiRequirements = () => {
      setNeedsApiKey(!hasApiKey() && !isApiOnboardingDismissed());
    };

    window.addEventListener("tama-config-changed", syncApiRequirements);
    return () => {
      window.removeEventListener("tama-config-changed", syncApiRequirements);
    };
  }, []);

  useEffect(() => {
    const handleDataChanged = (event: Event) => {
      const customEvent = event as CustomEvent<{ reason?: string }>;
      if (customEvent.detail?.reason === "account-restore") {
        setSelectedScenario(null);
        setSelectedOngoingChatId(null);
        setLastSession(null);
        setCurrentScreen("home");
        setDataVersion((value) => value + 1);
      }
    };

    window.addEventListener("tama-data-changed", handleDataChanged);
    return () => window.removeEventListener("tama-data-changed", handleDataChanged);
  }, []);

  useEffect(() => {
    switch (currentScreen) {
      case "sensei":
        break;
      case "scenario-select":
        setSenseiViewContext(buildScenarioSelectSenseiViewContext([], 0, locale));
        break;
      case "conversation":
        setSenseiViewContext(buildFallbackSenseiViewContext("conversation"));
        break;
      case "ongoing-chat":
        setSenseiViewContext(buildFallbackSenseiViewContext("ongoing-chat"));
        break;
      default:
        setSenseiViewContext(
          currentScreen === "home"
            ? buildHomeSenseiViewContext()
            : buildFallbackSenseiViewContext(currentScreen)
        );
        break;
    }
  }, [currentScreen, locale]);

  const handleApiKeyComplete = () => {
    setApiOnboardingDismissed(false);
    setNeedsApiKey(false);
  };

  const handleApiKeySkip = () => {
    setApiOnboardingDismissed(true);
    setNeedsApiKey(false);
  };

  const handleSessionEnd = (messages: Message[], scenario: Scenario) => {
    setLastSession({ messages, scenario });
    setCurrentScreen("session-complete");
  };

  const handleStartNewSession = () => {
    setSelectedScenario(null);
    setLastSession(null);
    setCurrentScreen("scenario-select");
  };

  const handleNavigate = (screen: string) => {
    setCurrentScreen(screen as Screen);
    if (screen !== "sensei") {
      setSenseiReturnScreen(screen as Exclude<Screen, "sensei">);
    }
  };

  const handleOpenSensei = (prompt?: string) => {
    if (senseiMode === "full") {
      if (currentScreen !== "sensei") {
        setSenseiReturnScreen(currentScreen);
      }
      setSenseiOpen(false);
      setCurrentScreen("sensei");
    } else {
      if (currentScreen === "sensei") {
        setCurrentScreen(senseiReturnScreen);
      }
      setSenseiOpen(true);
    }
    if (!prompt?.trim()) {
      return;
    }

    setPendingSenseiPromptRequest({
      id: crypto.randomUUID(),
      prompt: prompt.trim(),
    });
  };

  const handleExpandSensei = () => {
    setSenseiMode("full");
    if (currentScreen !== "sensei") {
      setSenseiReturnScreen(currentScreen);
    }
    setSenseiOpen(false);
    setCurrentScreen("sensei");
  };

  const handleMinimizeSensei = () => {
    setSenseiMode("sidebar");
    setCurrentScreen(senseiReturnScreen);
    setSenseiOpen(true);
  };

  const handleToggleSensei = () => {
    if (currentScreen === "sensei") {
      handleMinimizeSensei();
      return;
    }

    if (senseiMode === "full") {
      setSenseiReturnScreen(currentScreen);
      setSenseiOpen(false);
      setCurrentScreen("sensei");
      return;
    }

    setSenseiOpen((open) => !open);
  };

  if (needsApiKey) {
    return (
      <ApiKeyDialog
        open={true}
        onComplete={handleApiKeyComplete}
        onSkip={handleApiKeySkip}
      />
    );
  }

  const renderContent = () => {
    switch (currentScreen) {
      case "settings":
        return <Settings />;

      case "session-complete":
        if (!lastSession) return null;
        return (
          <FeedbackScreen
            messages={lastSession.messages}
            scenario={lastSession.scenario}
            onStartNewSession={handleStartNewSession}
            onGoHome={() => {
              setLastSession(null);
              setCurrentScreen("home");
            }}
          />
        );

      case "scenario-select":
        return (
          <ScenarioPicker
            onContextChange={setSenseiViewContext}
            onSelect={(scenario) => {
              setSelectedScenario(scenario);
              setCurrentScreen("conversation");
            }}
          />
        );

      case "conversation": {
        if (!selectedScenario) {
          return (
            <ScenarioPicker
              onSelect={(scenario) => {
                setSelectedScenario(scenario);
                setCurrentScreen("conversation");
              }}
            />
          );
        }
        return (
          <VoiceModeScreen
            scenario={selectedScenario}
            onEndSession={handleSessionEnd}
            onContextChange={setSenseiViewContext}
          />
        );
      }

      case "ongoing-chats":
        return (
          <OngoingChatList
            onSelectChat={(chatId) => {
              setSelectedOngoingChatId(chatId);
              setCurrentScreen("ongoing-chat");
            }}
          />
        );

      case "ongoing-chat":
        if (!selectedOngoingChatId) {
          return (
            <OngoingChatList
              onSelectChat={(chatId) => {
                setSelectedOngoingChatId(chatId);
                setCurrentScreen("ongoing-chat");
              }}
            />
          );
        }
        return (
          <OngoingChatScreen
            chatId={selectedOngoingChatId}
            onContextChange={setSenseiViewContext}
            onBack={() => {
              setSelectedOngoingChatId(null);
              setCurrentScreen("ongoing-chats");
            }}
          />
        );

      case "flashcards":
        return <FlashcardReview onContextChange={setSenseiViewContext} />;

      case "history":
        return <SessionHistory />;

      case "stats":
        return <StatsScreen />;

      case "sensei":
        return (
          <SenseiSidebar
            open={true}
            onOpenChange={() => undefined}
            currentViewContext={senseiViewContext}
            dataVersion={dataVersion}
            mode="full"
            onExpand={handleExpandSensei}
            onMinimize={handleMinimizeSensei}
            pendingPromptRequest={pendingSenseiPromptRequest}
            onPendingPromptHandled={(id) => {
              setPendingSenseiPromptRequest((current) => (current?.id === id ? null : current));
            }}
          />
        );

      case "home":
      default:
        return (
          <HomeScreen
            onBrowseScenarios={() => setCurrentScreen("scenario-select")}
            onFlashcards={() => setCurrentScreen("flashcards")}
            onContinueScenario={(scenario) => {
              setSelectedScenario(scenario);
              setCurrentScreen("conversation");
            }}
            onContinueChat={(chatId) => {
              setSelectedOngoingChatId(chatId);
              setCurrentScreen("ongoing-chat");
            }}
            onOngoingChats={() => setCurrentScreen("ongoing-chats")}
            onOpenSensei={handleOpenSensei}
            onContextChange={setSenseiViewContext}
          />
        );
    }
  };

  return (
    <TooltipProvider>
      <SidebarProvider open={false}>
        <AppSidebar
          currentScreen={currentScreen}
          onNavigate={handleNavigate}
          senseiOpen={senseiOpen || currentScreen === "sensei"}
          onToggleSensei={handleToggleSensei}
        />
        <SidebarInset>
          <ExpandButton />
          <div className="flex h-screen min-h-0 overflow-hidden">
            {currentScreen !== "sensei" ? (
              <SenseiSidebar
                open={senseiOpen}
                onOpenChange={setSenseiOpen}
                currentViewContext={senseiViewContext}
                dataVersion={dataVersion}
                mode="sidebar"
                onExpand={handleExpandSensei}
                onMinimize={handleMinimizeSensei}
                pendingPromptRequest={pendingSenseiPromptRequest}
                onPendingPromptHandled={(id) => {
                  setPendingSenseiPromptRequest((current) => (current?.id === id ? null : current));
                }}
              />
            ) : null}
            <main
              className={
                currentScreen === "sensei"
                  ? "min-h-0 min-w-0 flex-1 overflow-hidden"
                  : "min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden"
              }
            >
              <Suspense fallback={<ScreenLoader />}>
                <div
                  key={`${currentScreen}-${dataVersion}`}
                  className={currentScreen === "sensei" ? "min-h-0 h-full min-w-0 w-full" : "min-w-0 w-full"}
                >
                  {renderContent()}
                </div>
              </Suspense>
            </main>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}

export default App;
