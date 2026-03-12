import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { MessageBubble } from "@/components/conversation/MessageBubble";
import { initializeTTS, speak } from "@/services/tts";
import { sendMessage, sendMessageWithTools, buildScenarioPrompt } from "@/services/claude";
import { getUserProfile } from "@/services/storage";
import type { Message, Scenario, UserProfile } from "@/types";
import { v4 as uuidv4 } from "uuid";
import { Send, LogOut } from "lucide-react";

interface ConversationScreenProps {
  scenario: Scenario;
  onEndSession?: (messages: Message[], scenario: Scenario) => void;
  onModeChange?: (mode: "voice" | "classic") => void;
}

export function ConversationScreen({ scenario, onEndSession, onModeChange }: ConversationScreenProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [ttsStatus, setTtsStatus] = useState<{
    available: boolean;
    speakerName: string;
    checked: boolean;
  }>({ available: false, speakerName: "", checked: false });
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(!scenario.isCustom);

  const bottomRef = useRef<HTMLDivElement>(null);

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
    getUserProfile().then(setUserProfile).catch(console.error);
  }, []);

  useEffect(() => {
    setDetailsExpanded(!scenario.isCustom);
  }, [scenario.id, scenario.isCustom]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const handleUserMessage = useCallback(
    async (text: string) => {
      if (!text.trim()) return;

      setError(null);
      setIsLoading(true);

      // Add user message
      const userMessage: Message = {
        id: uuidv4(),
        role: "user",
        content: text.trim(),
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMessage]);

      try {
        const profile = userProfile || (await getUserProfile());
        const includeFlashcardVocab = profile.include_flashcard_vocab_in_conversations;
        const systemPrompt = buildScenarioPrompt(
          scenario,
          profile.jlpt_level,
          profile.auto_adjust_level,
          "Begin or continue the conversation in character.",
          profile.response_length,
          { name: profile.name, age: profile.age, aboutYou: profile.aboutYou },
          includeFlashcardVocab
        );

        const allMessages = [...messages, userMessage];
        const response = includeFlashcardVocab
          ? await sendMessageWithTools(allMessages, systemPrompt)
          : await sendMessage(allMessages, systemPrompt);

        // Add assistant message
        const assistantMessage: Message = {
          id: uuidv4(),
          role: "assistant",
          content: response,
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMessage]);

        if (ttsStatus.available) {
          setIsSpeaking(true);
          setSpeakingMessageId(assistantMessage.id);
          try {
            await speak(response);
          } catch (err) {
            console.error("TTS error:", err);
          } finally {
            setIsSpeaking(false);
            setSpeakingMessageId(null);
          }
        }
      } catch (err) {
        console.error("Error sending message:", err);
        setError(err instanceof Error ? err.message : "Failed to send message");
      } finally {
        setIsLoading(false);
      }
    },
    [messages, scenario, ttsStatus.available, userProfile]
  );

  const startSession = useCallback(async () => {
    setSessionStarted(true);
    setError(null);

    // Generate opening message from Claude
    setIsLoading(true);
    try {
      const profile = userProfile || (await getUserProfile());
      const includeFlashcardVocab = profile.include_flashcard_vocab_in_conversations;
      const systemPrompt = buildScenarioPrompt(
        scenario,
        profile.jlpt_level,
        profile.auto_adjust_level,
        "Start the conversation with a natural greeting in Japanese. Keep it simple and welcoming.",
        profile.response_length,
        { name: profile.name, age: profile.age, aboutYou: profile.aboutYou },
        includeFlashcardVocab
      );

      const response = includeFlashcardVocab
        ? await sendMessageWithTools([], systemPrompt)
        : await sendMessage([], systemPrompt);

      const assistantMessage: Message = {
        id: uuidv4(),
        role: "assistant",
        content: response,
        timestamp: new Date().toISOString(),
      };
      setMessages([assistantMessage]);

      if (ttsStatus.available) {
        setIsSpeaking(true);
        setSpeakingMessageId(assistantMessage.id);
        try {
          await speak(response);
        } catch (err) {
          console.error("TTS error:", err);
        } finally {
          setIsSpeaking(false);
          setSpeakingMessageId(null);
        }
      }
    } catch (err) {
      console.error("Error starting session:", err);
      setError(
        err instanceof Error ? err.message : "Failed to start conversation"
      );
    } finally {
      setIsLoading(false);
    }
  }, [scenario, ttsStatus.available, userProfile]);

  const endSession = useCallback(() => {
    if (onEndSession) {
      onEndSession(messages, scenario);
    }
  }, [messages, scenario, onEndSession]);

  // Not yet started - show scenario and start button
  if (!sessionStarted) {
    return (
      <div className="h-full overflow-y-auto p-4">
        <div className="mx-auto flex min-h-full w-full max-w-lg items-start justify-center py-4">
          <Card className="w-full">
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

              <div className="text-sm">
                <p>
                  <strong>Setting:</strong> {scenario.setting}
                </p>
              </div>

              {scenario.isCustom && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => setDetailsExpanded((prev) => !prev)}
                >
                  {detailsExpanded ? "Hide Scenario Details" : "Show Scenario Details"}
                </Button>
              )}

              {detailsExpanded && (
                <div className="text-sm space-y-2">
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
              )}

              <div className="flex flex-wrap gap-2 text-xs">
                {userProfile && (
                  <>
                    <Badge variant="secondary" className="bg-blue-100 text-blue-800">
                      Level: {userProfile.jlpt_level}
                    </Badge>
                    {userProfile.include_flashcard_vocab_in_conversations && (
                      <Badge variant="secondary" className="bg-amber-100 text-amber-900">
                        Vocab review: On
                      </Badge>
                    )}
                  </>
                )}
              </div>

              {/* Mode toggle */}
              {onModeChange && (
                <div className="flex rounded-lg border overflow-hidden">
                  <button
                    className="flex-1 py-2 text-sm font-medium hover:bg-muted transition-colors"
                    onClick={() => onModeChange("voice")}
                  >
                    Voice
                  </button>
                  <button
                    className="flex-1 py-2 text-sm font-medium bg-primary text-primary-foreground"
                    disabled
                  >
                    Text
                  </button>
                </div>
              )}

              <Button
                onClick={startSession}
                className="w-full"
                size="lg"
                disabled={isLoading}
              >
                {isLoading ? "Starting..." : "Start Session"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Conversation in progress
  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] max-w-2xl mx-auto p-4 overflow-hidden">
      {/* Error display */}
      {error && (
        <Alert variant="destructive" className="mb-4 shrink-0">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto mb-4 border rounded-lg">
        <div className="space-y-4 p-4">
          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              isSpeaking={message.id === speakingMessageId}
            />
          ))}

          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-lg px-4 py-2">
                <p className="text-muted-foreground">...</p>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input + actions */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.target as HTMLFormElement;
          const input = form.elements.namedItem("textInput") as HTMLInputElement;
          if (input.value.trim()) {
            handleUserMessage(input.value.trim());
            input.value = "";
          }
        }}
        className="flex gap-1.5 shrink-0"
      >
        <Input
          name="textInput"
          placeholder="Type in Japanese..."
          disabled={isLoading || isSpeaking}
          className="flex-1"
        />
        <Button type="submit" disabled={isLoading || isSpeaking} size="icon" title="Send">
          <Send className="size-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={endSession}
          title="End session"
        >
          <LogOut className="size-4" />
        </Button>
      </form>
    </div>
  );
}
