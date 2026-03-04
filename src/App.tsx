import { useState } from "react";
import { VoiceModeScreen } from "@/components/conversation/VoiceModeScreen";
import { FeedbackScreen } from "@/components/feedback/FeedbackScreen";
import { FlashcardReview } from "@/components/flashcard/FlashcardReview";
import { ScenarioPicker } from "@/components/ScenarioPicker";
import { HomeScreen } from "@/components/HomeScreen";
import { SessionHistory } from "@/components/SessionHistory";
import { ApiKeyDialog } from "@/components/ApiKeyDialog";
import { Settings } from "@/components/Settings";
import { OngoingChatList } from "@/components/ongoing/OngoingChatList";
import { OngoingChatScreen } from "@/components/ongoing/OngoingChatScreen";
import { AppSidebar } from "@/components/AppSidebar";
import { SidebarProvider, SidebarInset, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { hasApiKey } from "@/services/claude";
import { hasOpenAIApiKey } from "@/services/openai";
import type { Message, Scenario } from "@/types";

type Screen = "home" | "scenario-select" | "conversation" | "flashcards" | "history" | "settings" | "session-complete" | "ongoing-chats" | "ongoing-chat";

function ExpandButton() {
  const { open } = useSidebar();
  if (open) return null;
  return (
    <SidebarTrigger className="fixed top-2 left-2 z-50" />
  );
}

function App() {
  const [needsApiKey, setNeedsApiKey] = useState(
    !hasApiKey() || !hasOpenAIApiKey()
  );
  const [currentScreen, setCurrentScreen] = useState<Screen>("home");
  const [selectedScenario, setSelectedScenario] = useState<Scenario | null>(null);
  const [lastSession, setLastSession] = useState<{
    messages: Message[];
    scenario: Scenario;
  } | null>(null);
  const [selectedOngoingChatId, setSelectedOngoingChatId] = useState<string | null>(null);

  const handleApiKeyComplete = () => {
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
    return <ApiKeyDialog open={true} onComplete={handleApiKeyComplete} />;
  }

  const renderContent = () => {
    switch (currentScreen) {
      case "settings":
        return <Settings onBack={() => setCurrentScreen("home")} />;

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
            onBack={() => setCurrentScreen("home")}
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
              onBack={() => setCurrentScreen("home")}
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
            onBack={() => setCurrentScreen("home")}
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
        return (
          <SessionHistory
            onBack={() => setCurrentScreen("home")}
            onExportVocabulary={() => {}}
          />
        );

      case "home":
      default:
        return (
          <HomeScreen
            onBrowseScenarios={() => setCurrentScreen("scenario-select")}
            onFlashcards={() => setCurrentScreen("flashcards")}
            onHistory={() => setCurrentScreen("history")}
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
            {renderContent()}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}

export default App;
