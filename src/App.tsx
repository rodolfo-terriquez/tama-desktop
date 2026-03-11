import { Suspense, lazy, useEffect, useState } from "react";
import { ApiKeyDialog } from "@/components/ApiKeyDialog";
import { AppSidebar } from "@/components/AppSidebar";
import { SidebarProvider, SidebarInset, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { hasApiKey } from "@/services/claude";
import { checkForAppUpdatesOnLaunch } from "@/services/updater";
import type { Message, Scenario } from "@/types";

type Screen = "home" | "scenario-select" | "conversation" | "flashcards" | "history" | "stats" | "settings" | "session-complete" | "ongoing-chats" | "ongoing-chat";

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
  return (
    <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
      Loading...
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
  const API_ONBOARDING_DISMISSED_KEY = "tama_api_onboarding_dismissed";
  const isApiOnboardingDismissed = () =>
    localStorage.getItem(API_ONBOARDING_DISMISSED_KEY) === "1";
  const setApiOnboardingDismissed = (dismissed: boolean) => {
    if (dismissed) {
      localStorage.setItem(API_ONBOARDING_DISMISSED_KEY, "1");
      return;
    }
    localStorage.removeItem(API_ONBOARDING_DISMISSED_KEY);
  };

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

  useEffect(() => {
    void checkForAppUpdatesOnLaunch();
  }, []);

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
          setCurrentScreen("ongoing-chats");
          return null;
        }
        return (
          <OngoingChatScreen
            chatId={selectedOngoingChatId}
            onBack={() => {
              setSelectedOngoingChatId(null);
              setCurrentScreen("ongoing-chats");
            }}
          />
        );

      case "flashcards":
        return <FlashcardReview />;

      case "history":
        return <SessionHistory />;

      case "stats":
        return <StatsScreen />;

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
          />
        );
    }
  };

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar
          currentScreen={currentScreen}
          onNavigate={handleNavigate}
        />
        <SidebarInset>
          <ExpandButton />
          <main className="flex-1 h-screen overflow-auto">
            <Suspense fallback={<ScreenLoader />}>
              {renderContent()}
            </Suspense>
          </main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}

export default App;
