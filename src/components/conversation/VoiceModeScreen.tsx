import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { VoiceVisualizer } from "@/components/conversation/VoiceVisualizer";
import { TranscriptBubbles } from "@/components/conversation/TranscriptBubbles";
import { MessageBubble } from "@/components/conversation/MessageBubble";
import { localizeScenario } from "@/data/scenarios";
import { useVADRecorder } from "@/hooks/useVADRecorder";
import { useI18n } from "@/i18n";
import {
  buildScenarioConversationSenseiViewContext,
  buildScenarioPreviewSenseiViewContext,
} from "@/services/sensei-context";
import {
  getEnglishVoiceDisplayName,
  initializeTTS,
  speak,
  stopCurrentAudio,
  getStoredEngineType,
} from "@/services/tts";
import { getTranscriptionEngine } from "@/services/transcription";
import { sendMessage, sendMessageWithTools, buildScenarioPrompt } from "@/services/claude";
import { getUserProfile } from "@/services/storage";
import type { Message, Scenario, SenseiViewContext, UserProfile } from "@/types";
import { v4 as uuidv4 } from "uuid";
import { Send, Mic, Keyboard, LogOut } from "lucide-react";

type InputMode = "voice" | "text";

type ConversationState =
  | "idle"
  | "listening"
  | "transcribing"
  | "thinking"
  | "speaking";

interface VoiceModeScreenProps {
  scenario: Scenario;
  onEndSession?: (messages: Message[], scenario: Scenario) => void;
  onContextChange?: (context: SenseiViewContext) => void;
}

export function VoiceModeScreen({ scenario, onEndSession, onContextChange }: VoiceModeScreenProps) {
  const { locale, t } = useI18n();
  const localizedScenario = localizeScenario(scenario, locale);
  const [messages, setMessages] = useState<Message[]>([]);
  const [started, setStarted] = useState(false);
  const [inputMode, setInputMode] = useState<InputMode>("voice");
  const [conversationState, setConversationState] = useState<ConversationState>("idle");
  const [amplitude, setAmplitude] = useState(0);
  const [ttsStatus, setTtsStatus] = useState<{
    available: boolean;
    speakerName: string;
    checked: boolean;
  }>({ available: false, speakerName: "", checked: false });
  const [error, setError] = useState<string | null>(null);
  const [showCaptions, setShowCaptions] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [detailsExpanded, setDetailsExpanded] = useState(!scenario.isCustom);
  const [isLoading, setIsLoading] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);

  const messagesRef = useRef<Message[]>([]);
  const sessionEndedRef = useRef(false);
  const conversationStateRef = useRef<ConversationState>("idle");
  const bottomRef = useRef<HTMLDivElement>(null);
  // Refs for VAD controls so handlers can call them synchronously without waiting for state/effect cycle
  const pauseVADRef = useRef<() => void>(() => {});
  const resumeVADRef = useRef<() => void>(() => {});
  const getStartVADOptions = useCallback(
    () => ({
      requireWhisperLoaded: getTranscriptionEngine() === "local",
    }),
    []
  );

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { conversationStateRef.current = conversationState; }, [conversationState]);
  useEffect(() => {
    getUserProfile().then(setUserProfile).catch(console.error);
  }, []);

  useEffect(() => {
    setDetailsExpanded(!scenario.isCustom);
  }, [scenario.id, scenario.isCustom]);

  useEffect(() => {
    if (!started) {
      onContextChange?.(
        buildScenarioPreviewSenseiViewContext({
          scenario,
          locale,
          level: userProfile?.jlpt_level,
          vocabReviewEnabled: userProfile?.include_flashcard_vocab_in_conversations,
          ttsStatus: !ttsStatus.checked ? "checking" : ttsStatus.available ? "available" : "unavailable",
        })
      );
      return;
    }

    onContextChange?.(
      buildScenarioConversationSenseiViewContext({
        scenario,
        locale,
        inputMode,
        conversationState,
        started,
        messages,
      })
    );
  }, [conversationState, inputMode, locale, messages, onContextChange, scenario, started, ttsStatus.available, ttsStatus.checked, userProfile]);

  useEffect(() => {
    async function checkTTS() {
      try {
        const result = await initializeTTS();
        setTtsStatus({ available: result.available, speakerName: result.speakerName, checked: true });
      } catch {
        setTtsStatus({ available: false, speakerName: "", checked: true });
      }
    }
    checkTTS();
  }, []);

  useEffect(() => {
    if (inputMode === "text") {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isLoading, inputMode]);

  // --- Shared send logic ---
  const sendAndRespond = useCallback(
    async (text: string): Promise<{ response: string; assistantMessage: Message } | undefined> => {
      if (!text.trim()) return undefined;

      setError(null);
      setIsLoading(true);

      const userMessage: Message = {
        id: uuidv4(),
        role: "user",
        content: text.trim(),
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMessage]);

      try {
        const includeFlashcardVocab = userProfile?.include_flashcard_vocab_in_conversations ?? true;
        const systemPrompt = buildScenarioPrompt(
          scenario,
          userProfile?.jlpt_level || "N5",
          userProfile?.auto_adjust_level || false,
          "Continue the conversation in character.",
          userProfile?.response_length || "natural",
          { name: userProfile?.name, age: userProfile?.age, aboutYou: userProfile?.aboutYou },
          includeFlashcardVocab
        );

        const allMessages = [...messagesRef.current, userMessage];
        const response = includeFlashcardVocab
          ? await sendMessageWithTools(allMessages, systemPrompt)
          : await sendMessage(allMessages, systemPrompt);

        if (sessionEndedRef.current) return undefined;

        const assistantMessage: Message = {
          id: uuidv4(),
          role: "assistant",
          content: response,
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMessage]);

        return { response, assistantMessage };
      } catch (err) {
        if (sessionEndedRef.current) return undefined;
        const errMsg = err instanceof Error ? err.message : "Failed to process";
        const friendlyMsg = errMsg.includes("No text content")
          ? t("scenario.aiNoText")
          : errMsg;
        setError(friendlyMsg);
        setTimeout(() => setError(null), 5000);
        return undefined;
      } finally {
        setIsLoading(false);
      }
    },
    [scenario, userProfile]
  );

  // --- Voice transcription handler ---
  const handleVoiceTranscription = useCallback(
    async (transcript: string) => {
      if (sessionEndedRef.current) return;
      
      // Guard against processing transcription while AI is speaking or thinking
      // This prevents the AI from responding to its own voice (audio feedback loop)
      const currentState = conversationStateRef.current;
      if (currentState === "speaking" || currentState === "thinking") {
        console.log("Ignoring transcription during", currentState, "state");
        return;
      }
      
      if (!transcript?.trim()) {
        setConversationState("listening");
        return;
      }

      setConversationState("thinking");
      const result = await sendAndRespond(transcript);

      if (sessionEndedRef.current) return;

      if (result && ttsStatus.available) {
        // Pause VAD synchronously BEFORE speaking to prevent mic picking up TTS audio
        pauseVADRef.current();
        setConversationState("speaking");
        try {
          await speak(result.response, { onAmplitude: setAmplitude });
        } catch (err) {
          console.error("TTS error:", err);
        }
        // Wait for audio to fully clear before resuming mic
        await new Promise((r) => setTimeout(r, 600));
      }

      if (sessionEndedRef.current) return;
      setAmplitude(0);
      resumeVADRef.current();
      setConversationState("listening");
    },
    [sendAndRespond, ttsStatus.available]
  );

  // --- Text submit handler ---
  const handleTextSubmit = useCallback(
    async (text: string) => {
      const result = await sendAndRespond(text);
      if (result && ttsStatus.available) {
        setSpeakingMessageId(result.assistantMessage.id);
        try {
          await speak(result.response);
        } catch (err) {
          console.error("TTS error:", err);
        } finally {
          setSpeakingMessageId(null);
        }
      }
    },
    [sendAndRespond, ttsStatus.available]
  );

  const {
    isListening,
    isSpeaking: userIsSpeaking,
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
    onTranscription: handleVoiceTranscription,
    onAmplitude: setAmplitude,
  });

  // Keep refs in sync so handlers can call pause/resume synchronously
  useEffect(() => { pauseVADRef.current = pauseVAD; }, [pauseVAD]);
  useEffect(() => { resumeVADRef.current = resumeVAD; }, [resumeVAD]);

  // Only pause Rust audio capture when the AI is actually speaking (TTS active).
  // Do NOT pause during "transcribing" or "thinking" — that would cause the
  // user's own transcription to be dropped by the JS isPausedRef check.
  // The explicit pauseVADRef.current() call before speak() handles TTS gating.
  useEffect(() => {
    if (inputMode !== "voice" || !started) return;
    if (conversationState === "listening" && isListening) {
      resumeVAD();
    }
  }, [conversationState, inputMode, started, isListening, resumeVAD]);

  // --- Start session (always starts in voice mode) ---
  const handleStartConversation = useCallback(async () => {
    setStarted(true);
    setError(null);
    setConversationState("thinking");

    try {
      const includeFlashcardVocab = userProfile?.include_flashcard_vocab_in_conversations ?? true;
      await startVAD(getStartVADOptions());

      const systemPrompt = buildScenarioPrompt(
        scenario,
        userProfile?.jlpt_level || "N5",
        userProfile?.auto_adjust_level || false,
        "Start the conversation with a natural greeting in Japanese. Keep it simple and welcoming.",
        userProfile?.response_length || "natural",
        { name: userProfile?.name, age: userProfile?.age, aboutYou: userProfile?.aboutYou },
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
        // Pause VAD synchronously BEFORE speaking to prevent mic picking up TTS audio
        pauseVADRef.current();
        setConversationState("speaking");
        try {
          await speak(response, { onAmplitude: setAmplitude });
        } catch (err) {
          console.error("TTS error:", err);
        }
        // Wait for audio to fully clear before resuming mic
        await new Promise((r) => setTimeout(r, 600));
      }

      setAmplitude(0);
      resumeVADRef.current();
      setConversationState("listening");
    } catch (err) {
      console.error("Error starting session:", err);
      setError(err instanceof Error ? err.message : t("scenario.failedToStart"));
      setConversationState("idle");
    }
  }, [getStartVADOptions, scenario, t, ttsStatus.available, startVAD, userProfile]);

  // --- Mode switching ---
  const handleSwitchToText = useCallback(() => {
    pauseVAD();
    stopCurrentAudio();
    setInputMode("text");
    setConversationState("idle");
    setAmplitude(0);
  }, [pauseVAD]);

  const handleSwitchToVoice = useCallback(async () => {
    setInputMode("voice");
    setConversationState("listening");
    if (!isListening) {
      await startVAD(getStartVADOptions());
    } else {
      resumeVAD();
    }
  }, [getStartVADOptions, isListening, startVAD, resumeVAD]);

  // --- End session ---
  const endSession = useCallback(() => {
    sessionEndedRef.current = true;
    stopVAD();
    stopCurrentAudio();
    if (onEndSession) {
      onEndSession(messages, scenario);
    }
  }, [messages, scenario, onEndSession, stopVAD]);

  // ── Setup screen ──
  if (!started) {
    return (
      <div className="h-[calc(100vh-3rem)] overflow-y-auto p-4">
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
                <p><strong>{t("scenario.settingLabel")}</strong> {localizedScenario.setting}</p>
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
                  <p><strong>{t("scenario.partnerLabel")}</strong> {localizedScenario.character_role}</p>
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
                {ttsStatus.checked && (
                  <Badge variant={ttsStatus.available ? "success" : "destructive-soft"}>
                    {ttsStatus.available
                      ? t("scenario.ttsVoice", { voice: getEnglishVoiceDisplayName(ttsStatus.speakerName) })
                      : t("scenario.ttsOffline", { engine: getStoredEngineType() === "voicevox" ? "VOICEVOX" : "SBV2" })}
                  </Badge>
                )}
              </div>

              {(vadError || error) && (
                <Alert variant="destructive">
                  <AlertDescription>{vadError || error}</AlertDescription>
                </Alert>
              )}

              <Button
                onClick={handleStartConversation}
                className="w-full"
                size="lg"
                disabled={!ttsStatus.available || vadLoading}
              >
                {t("scenario.startSession")}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // ── Voice mode ──
  if (inputMode === "voice") {
    const hasTranscript = showCaptions && messages.length > 0;

    return (
      <div className="flex h-[calc(100vh-3rem)] flex-col max-w-2xl mx-auto overflow-hidden">
        {error && (
          <Alert variant="destructive" className="mx-4 mt-2 mb-0">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className={`flex flex-col items-center justify-center ${hasTranscript ? "py-6 flex-shrink-0" : "flex-1 min-h-0"}`}>
          <VoiceVisualizer
            amplitude={amplitude}
            isSpeaking={conversationState === "speaking"}
            isListening={conversationState === "listening" && isListening}
            isUserSpeaking={userIsSpeaking}
            isProcessing={conversationState === "transcribing" || conversationState === "thinking"}
            size={120}
          />
        </div>

        {hasTranscript && (
          <div className="flex-1 min-h-0 flex flex-col px-4">
            <div className="flex-1 min-h-0">
              <TranscriptBubbles messages={messages} visibleCount={4} />
            </div>
          </div>
        )}

        <div className="flex-shrink-0 flex justify-center gap-3 py-3 px-4">
          <Button variant="ghost" size="sm" onClick={() => setShowCaptions(!showCaptions)}>
            {showCaptions ? t("scenario.hideTranscript") : t("scenario.showTranscript")}
          </Button>
          <Button variant="ghost" size="sm" onClick={handleSwitchToText}>
            <Keyboard className="size-4 mr-1" />
            {t("scenario.textMode")}
          </Button>
          <Button variant="outline" size="sm" onClick={endSession}>
            {t("scenario.endConversation")}
          </Button>
        </div>
      </div>
    );
  }

  // ── Text mode ──
  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col max-w-2xl mx-auto p-4 overflow-hidden">
      {error && (
        <Alert variant="destructive" className="mb-4 shrink-0">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

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

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.target as HTMLFormElement;
          const input = form.elements.namedItem("textInput") as HTMLInputElement;
          if (input.value.trim()) {
            handleTextSubmit(input.value.trim());
            input.value = "";
          }
        }}
        className="flex gap-1.5 shrink-0"
      >
        <Input
          name="textInput"
          placeholder={t("scenario.typeInJapanese")}
          disabled={isLoading}
          className="flex-1"
        />
        <Button type="submit" disabled={isLoading} size="icon" title={t("scenario.send")}>
          <Send className="size-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={handleSwitchToVoice}
          title={t("scenario.switchToVoice")}
        >
          <Mic className="size-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={endSession}
          title={t("scenario.endSession")}
        >
          <LogOut className="size-4" />
        </Button>
      </form>
    </div>
  );
}
