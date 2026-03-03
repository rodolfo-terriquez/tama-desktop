import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { VoiceVisualizer } from "@/components/conversation/VoiceVisualizer";
import { TranscriptBubbles } from "@/components/conversation/TranscriptBubbles";
import { useVADRecorder } from "@/hooks/useVADRecorder";
import {
  initializeTTS,
  speak,
  stopCurrentAudio,
  getStoredEngineType,
} from "@/services/tts";
import { sendMessageWithTools, buildScenarioPrompt } from "@/services/claude";
import { getUserProfile } from "@/services/storage";
import type { Message, Scenario, UserProfile } from "@/types";
import { v4 as uuidv4 } from "uuid";

type ScreenState = "setup" | "conversation";

type ConversationState =
  | "idle"
  | "listening"
  | "transcribing"
  | "thinking"
  | "speaking";

interface VoiceModeScreenProps {
  scenario: Scenario;
  onEndSession?: (messages: Message[], scenario: Scenario) => void;
  onModeChange?: (mode: "voice" | "classic") => void;
}

export function VoiceModeScreen({ scenario, onEndSession, onModeChange }: VoiceModeScreenProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [screenState, setScreenState] = useState<ScreenState>("setup");
  const [conversationState, setConversationState] =
    useState<ConversationState>("idle");
  const [amplitude, setAmplitude] = useState(0);
  const [ttsStatus, setTtsStatus] = useState<{
    available: boolean;
    speakerName: string;
    checked: boolean;
  }>({ available: false, speakerName: "", checked: false });
  const [error, setError] = useState<string | null>(null);
  const [showCaptions, setShowCaptions] = useState(false);
  const [currentTranscript, setCurrentTranscript] = useState<string>("");
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);

  const messagesRef = useRef<Message[]>([]);
  const sessionEndedRef = useRef(false);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    getUserProfile().then(setUserProfile);
  }, []);

  const handleTranscription = useCallback(
    async (transcript: string) => {
      if (screenState !== "conversation" || sessionEndedRef.current) return;
      if (!transcript || !transcript.trim()) {
        setConversationState("listening");
        return;
      }

      setConversationState("transcribing");
      setCurrentTranscript(transcript);

      try {
        const userMessage: Message = {
          id: uuidv4(),
          role: "user",
          content: transcript.trim(),
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, userMessage]);

        setConversationState("thinking");

        const systemPrompt = buildScenarioPrompt(
          scenario,
          userProfile?.jlpt_level || "N5",
          userProfile?.auto_adjust_level || false,
          "Continue the conversation in character.",
          userProfile?.response_length || "natural"
        );

        const allMessages = [...messagesRef.current, userMessage];
        const response = await sendMessageWithTools(allMessages, systemPrompt);

        if (sessionEndedRef.current) return;

        const assistantMessage: Message = {
          id: uuidv4(),
          role: "assistant",
          content: response,
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMessage]);

        if (ttsStatus.available && !sessionEndedRef.current) {
          setConversationState("speaking");
          try {
            await speak(response, {
              onAmplitude: setAmplitude,
            });
          } catch (err) {
            console.error("TTS error:", err);
          }
        }

        if (sessionEndedRef.current) return;

        setConversationState("listening");
        setAmplitude(0);
      } catch (err) {
        if (sessionEndedRef.current) return;
        console.error("Error processing speech:", err);
        const errMsg = err instanceof Error ? err.message : "Failed to process speech";
        const friendlyMsg = errMsg.includes("No text content")
          ? "The AI didn't respond with text. Please try speaking again."
          : errMsg;
        setError(friendlyMsg);
        setConversationState("listening");
        setTimeout(() => setError(null), 5000);
      }
    },
    [screenState, scenario, ttsStatus.available, userProfile]
  );

  const {
    isListening,
    isSpeaking: userIsSpeaking,
    isSupported: vadSupported,
    isLoading: vadLoading,
    error: vadError,
    start: startVAD,
    stop: stopVAD,
    pause: pauseVAD,
    resume: resumeVAD,
  } = useVADRecorder({
    onSpeechStart: () => {
      if (conversationState === "speaking") {
        stopCurrentAudio();
        setConversationState("listening");
      }
    },
    onSpeechEnd: () => {
      setConversationState("transcribing");
    },
    onTranscription: handleTranscription,
    onAmplitude: setAmplitude,
  });

  useEffect(() => {
    async function checkTTS() {
      try {
        const result = await initializeTTS();
        setTtsStatus({
          available: result.available,
          speakerName: result.speakerName,
          checked: true,
        });
      } catch (err) {
        console.error("TTS check failed:", err);
        setTtsStatus({ available: false, speakerName: "", checked: true });
      }
    }
    checkTTS();
  }, []);

  useEffect(() => {
    if (screenState !== "conversation") return;

    if (conversationState === "listening" && isListening) {
      resumeVAD();
    } else if (conversationState !== "listening" && isListening) {
      pauseVAD();
    }
  }, [conversationState, screenState, isListening, pauseVAD, resumeVAD]);

  const handleStartConversation = useCallback(async () => {
    setScreenState("conversation");
    setError(null);
    setConversationState("thinking");

    try {
      const systemPrompt = buildScenarioPrompt(
        scenario,
        userProfile?.jlpt_level || "N5",
        userProfile?.auto_adjust_level || false,
        "Start the conversation with a natural greeting in Japanese. Keep it simple and welcoming.",
        userProfile?.response_length || "natural"
      );

      const response = await sendMessageWithTools([], systemPrompt);

      const assistantMessage: Message = {
        id: uuidv4(),
        role: "assistant",
        content: response,
        timestamp: new Date().toISOString(),
      };
      setMessages([assistantMessage]);

      if (ttsStatus.available) {
        setConversationState("speaking");
        try {
          await speak(response, {
            onAmplitude: setAmplitude,
          });
        } catch (err) {
          console.error("TTS error:", err);
        }
      }

      setConversationState("listening");
      setAmplitude(0);
      await startVAD();
    } catch (err) {
      console.error("Error starting session:", err);
      setError(
        err instanceof Error ? err.message : "Failed to start conversation"
      );
      setConversationState("idle");
    }
  }, [scenario, ttsStatus.available, startVAD, userProfile]);

  const endSession = useCallback(() => {
    sessionEndedRef.current = true;
    stopVAD();
    stopCurrentAudio();
    if (onEndSession) {
      onEndSession(messages, scenario);
    }
  }, [messages, scenario, onEndSession, stopVAD]);

  const getStatusText = () => {
    if (userIsSpeaking) {
      return "Listening...";
    }
    switch (conversationState) {
      case "idle":
        return "Ready to start";
      case "listening":
        return isListening ? "Speak now..." : "Starting microphone...";
      case "transcribing":
        return "Processing your speech...";
      case "thinking":
        return "Thinking...";
      case "speaking":
        return "Speaking...";
      default:
        return "";
    }
  };

  if (screenState === "setup") {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle className="text-center">
              {scenario.title_ja}
              <span className="block text-sm font-normal text-muted-foreground mt-1">
                {scenario.title}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">{scenario.description}</p>

            <div className="text-sm space-y-2">
              <p>
                <strong>Setting:</strong> {scenario.setting}
              </p>
              <p>
                <strong>Your partner:</strong> {scenario.character_role}
              </p>
              <div>
                <strong>Objectives:</strong>
                <ul className="list-disc list-inside mt-1">
                  {scenario.objectives.map((obj, i) => (
                    <li key={i}>{obj}</li>
                  ))}
                </ul>
              </div>
              {scenario.custom_prompt && (
                <div>
                  <strong>Conversation structure:</strong>
                  <p className="mt-1 text-muted-foreground whitespace-pre-line text-xs bg-muted/50 rounded p-2">
                    {scenario.custom_prompt}
                  </p>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2 text-xs">
              {userProfile && (
                <span className="px-2 py-1 rounded bg-blue-100 text-blue-800">
                  Level: {userProfile.jlpt_level}
                </span>
              )}
              {ttsStatus.checked && (
                <span
                  className={`px-2 py-1 rounded ${
                    ttsStatus.available
                      ? "bg-green-100 text-green-800"
                      : "bg-red-100 text-red-800"
                  }`}
                >
                  {ttsStatus.available
                    ? `TTS: ${ttsStatus.speakerName}`
                    : `TTS: ${getStoredEngineType() === "voicevox" ? "VOICEVOX" : "SBV2"} not running`}
                </span>
              )}
              <span
                className={`px-2 py-1 rounded ${
                  vadSupported
                    ? "bg-green-100 text-green-800"
                    : "bg-red-100 text-red-800"
                }`}
              >
                {vadLoading
                  ? "Mic: Loading..."
                  : vadSupported
                  ? "Mic: Ready"
                  : "Mic: Not supported"}
              </span>
            </div>

            {(vadError || error) && (
              <Alert variant="destructive">
                <AlertDescription>{vadError || error}</AlertDescription>
              </Alert>
            )}

            {onModeChange && (
              <div className="flex rounded-lg border overflow-hidden">
                <button
                  className="flex-1 py-2 text-sm font-medium bg-primary text-primary-foreground"
                  disabled
                >
                  Voice
                </button>
                <button
                  className="flex-1 py-2 text-sm font-medium hover:bg-muted transition-colors"
                  onClick={() => onModeChange("classic")}
                >
                  Text
                </button>
              </div>
            )}

            <Button
              onClick={handleStartConversation}
              className="w-full"
              size="lg"
              disabled={!ttsStatus.available || vadLoading}
            >
              Start Session
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full max-w-2xl mx-auto p-4 overflow-hidden">
      <div className="flex justify-between items-center mb-2">
        <div className="text-sm text-muted-foreground">{scenario.title_ja}</div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowCaptions(!showCaptions)}
        >
          {showCaptions ? "Hide Transcript" : "Show Transcript"}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-2">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex-1 flex flex-col items-center justify-center min-h-0">
        <div className="flex-shrink-0">
          <VoiceVisualizer
            amplitude={amplitude}
            isSpeaking={conversationState === "speaking"}
            isListening={conversationState === "listening" && isListening}
            isUserSpeaking={userIsSpeaking}
            isProcessing={
              conversationState === "transcribing" ||
              conversationState === "thinking"
            }
            size={200}
          />
        </div>

        <p className="mt-4 text-lg text-muted-foreground">{getStatusText()}</p>

        {currentTranscript && conversationState === "thinking" && (
          <p className="mt-2 text-sm text-muted-foreground italic max-w-md text-center">
            "{currentTranscript}"
          </p>
        )}

        {showCaptions && messages.length > 0 && (
          <div className="mt-6 w-full flex-1 min-h-0 max-h-64">
            <TranscriptBubbles messages={messages} visibleCount={3} />
          </div>
        )}

        <Button
          variant="outline"
          size="lg"
          onClick={endSession}
          className="mt-6 flex-shrink-0"
        >
          End Conversation
        </Button>
      </div>

      <div className="mt-4 flex justify-center text-xs text-muted-foreground">
        {ttsStatus.available && (
          <span>TTS: {ttsStatus.speakerName}</span>
        )}
      </div>
    </div>
  );
}
