import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { MessageBubble } from "@/components/conversation/MessageBubble";
import { localizeScenario } from "@/data/scenarios";
import { useI18n } from "@/i18n";
import { initializeTTS, speak } from "@/services/tts";
import { sendMessage, sendMessageWithTools, buildScenarioPrompt } from "@/services/claude";
import { getUserProfile } from "@/services/storage";
import type { Message, Scenario, UserProfile } from "@/types";
import { v4 as uuidv4 } from "uuid";
import { Mic, Send, LogOut } from "lucide-react";

interface ConversationScreenProps {
  scenario: Scenario;
  onEndSession?: (messages: Message[], scenario: Scenario) => void;
  onModeChange?: (mode: "voice" | "classic") => void;
}

export function ConversationScreen({ scenario, onEndSession, onModeChange }: ConversationScreenProps) {
  const { locale, t } = useI18n();
  const localizedScenario = localizeScenario(scenario, locale);
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
  const [draftMessage, setDraftMessage] = useState("");

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
        setError(err instanceof Error ? err.message : t("scenario.failedToSend"));
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
        err instanceof Error ? err.message : t("scenario.failedToStart")
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
                  {localizedScenario.title}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground">{localizedScenario.description}</p>

              <div className="text-sm">
                <p>
                  <strong>{t("scenario.settingLabel")}</strong> {localizedScenario.setting}
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
                  {detailsExpanded ? t("scenario.hideDetails") : t("scenario.showDetails")}
                </Button>
              )}

              {detailsExpanded && (
                <div className="text-sm space-y-2">
                  <p>
                    <strong>{t("scenario.partnerLabel")}</strong> {localizedScenario.character_role}
                  </p>
                  <div>
                    <strong>{t("scenario.objectivesLabel")}</strong>
                    <ul className="list-disc list-inside mt-1">
                      {localizedScenario.objectives.map((obj, i) => (
                        <li key={i}>{obj}</li>
                      ))}
                    </ul>
                  </div>
                  {scenario.custom_prompt && (
                    <div>
                      <strong>{t("scenario.structureLabel")}</strong>
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
                    <Badge
                      variant="accent"
                    >
                      {t("scenario.levelLabel", { level: userProfile.jlpt_level })}
                    </Badge>
                    {userProfile.include_flashcard_vocab_in_conversations && (
                      <Badge variant="review">
                        {t("scenario.vocabReviewOn")}
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
                    {t("scenario.voiceMode")}
                  </button>
                  <button
                    className="flex-1 py-2 text-sm font-medium bg-primary text-primary-foreground"
                    disabled
                  >
                    {t("scenario.textMode")}
                  </button>
                </div>
              )}

              <Button
                onClick={startSession}
                className="w-full"
                size="lg"
                disabled={isLoading}
              >
                {isLoading ? t("scenario.starting") : t("scenario.startSession")}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Conversation in progress
  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden bg-background">
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1">
        <div className="relative flex min-h-0 flex-1 flex-col">
      {/* Error display */}
      {error && (
        <Alert variant="destructive" className="mx-4 mt-4 shrink-0">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Messages */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 px-4 pt-4 pb-28">
          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              isSpeaking={message.id === speakingMessageId}
              layout="sensei-like"
            />
          ))}

          {isLoading && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2 text-sm text-muted-foreground">
                <p>...</p>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Input + actions */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const value = draftMessage.trim();
          if (value) {
            void handleUserMessage(value);
            setDraftMessage("");
          }
        }}
        className="absolute inset-x-3 bottom-3 z-20"
      >
        <div className="rounded-2xl border border-border/80 bg-background/95 px-3 pt-2.5 pb-2 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/85">
          <Textarea
            name="textInput"
            placeholder={t("scenario.typeInJapanese")}
            disabled={isLoading || isSpeaking}
            value={draftMessage}
            onChange={(event) => setDraftMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                const value = draftMessage.trim();
                if (value && !isLoading && !isSpeaking) {
                  void handleUserMessage(value);
                  setDraftMessage("");
                }
              }
            }}
            className="min-h-[56px] resize-none border-0 bg-transparent px-0 py-0 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <div className="mt-1.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-1">
              {onModeChange ? (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => onModeChange("voice")}
                  title={t("scenario.voiceMode")}
                  className="size-8 rounded-full"
                >
                  <Mic className="size-4" />
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={endSession}
                title={t("scenario.endSession")}
                className="size-8 rounded-full"
              >
                <LogOut className="size-4" />
              </Button>
            </div>
            <Button
              type="submit"
              disabled={isLoading || isSpeaking || !draftMessage.trim()}
              size="icon"
              title={t("scenario.send")}
              className="size-9 shrink-0 rounded-full"
            >
              <Send className="size-4" />
            </Button>
          </div>
        </div>
      </form>
        </div>
      </div>
    </div>
  );
}
