import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ShadowModeScreen } from "@/components/conversation/ShadowModeScreen";
import { VoiceVisualizer } from "@/components/conversation/VoiceVisualizer";
import { TranscriptBubbles } from "@/components/conversation/TranscriptBubbles";
import { MessageBubble } from "@/components/conversation/MessageBubble";
import { localizeScenario } from "@/data/scenarios";
import { useVADRecorder } from "@/hooks/useVADRecorder";
import { useI18n } from "@/i18n";
import {
  buildShadowPreviewSenseiViewContext,
  buildScenarioConversationSenseiViewContext,
  buildScenarioPreviewSenseiViewContext,
} from "@/services/sensei-context";
import { shadowScriptHasRequiredMetadata } from "@/services/shadow";
import {
  getEnglishVoiceDisplayName,
  initializeTTS,
  speak,
  stopCurrentAudio,
  getStoredEngineType,
} from "@/services/tts";
import { getTranscriptionEngine } from "@/services/transcription";
import { buildScenarioPrompt, generateShadowScript, sendMessage, sendMessageWithTools } from "@/services/claude";
import { getShadowScript, getUserProfile, saveShadowScript } from "@/services/storage";
import type { Message, Scenario, ScenarioRunMode, SenseiViewContext, ShadowScript, UserProfile } from "@/types";
import { v4 as uuidv4 } from "uuid";
import { Loader2, Send, Mic, Keyboard, LogOut, RefreshCcw } from "lucide-react";

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
  const [runMode, setRunMode] = useState<ScenarioRunMode>("conversation");
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
  const [isShadowLoading, setIsShadowLoading] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [shadowScript, setShadowScript] = useState<ShadowScript | null>(null);

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
    setRunMode("conversation");
    setStarted(false);
    setMessages([]);
    setConversationState("idle");
    setInputMode("voice");
    setError(null);
    setShowCaptions(false);
    setSpeakingMessageId(null);
    setShadowScript(null);
    sessionEndedRef.current = false;
  }, [scenario.id, scenario.isCustom]);

  useEffect(() => {
    getShadowScript(scenario.id)
      .then((loadedScript) => {
        setShadowScript(
          loadedScript && shadowScriptHasRequiredMetadata(loadedScript)
            ? loadedScript
            : null
        );
      })
      .catch((err) => {
        console.error("Failed to load shadow script:", err);
        setShadowScript(null);
      });
  }, [scenario.id]);

  useEffect(() => {
    if (!started) {
      if (runMode === "shadow") {
        onContextChange?.(
          buildShadowPreviewSenseiViewContext({
            scenario,
            locale,
            level: userProfile?.jlpt_level,
            ttsStatus: !ttsStatus.checked ? "checking" : ttsStatus.available ? "available" : "unavailable",
            shadowScript,
          })
        );
      } else {
        onContextChange?.(
          buildScenarioPreviewSenseiViewContext({
            scenario,
            locale,
            level: userProfile?.jlpt_level,
            vocabReviewEnabled: userProfile?.include_flashcard_vocab_in_conversations,
            ttsStatus: !ttsStatus.checked ? "checking" : ttsStatus.available ? "available" : "unavailable",
          })
        );
      }
      return;
    }

    if (runMode === "shadow") {
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
  }, [conversationState, inputMode, locale, messages, onContextChange, runMode, scenario, shadowScript, started, ttsStatus.available, ttsStatus.checked, userProfile]);

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

  const generateAndPersistShadowScript = useCallback(
    async (forceRegenerate: boolean): Promise<ShadowScript> => {
      if (!forceRegenerate && shadowScript && shadowScriptHasRequiredMetadata(shadowScript)) {
        return shadowScript;
      }

      const profile = userProfile || (await getUserProfile());
      const generated = await generateShadowScript(
        scenario,
        profile.jlpt_level,
        profile.response_length,
        { name: profile.name, age: profile.age, aboutYou: profile.aboutYou }
      );

      const nextScript: ShadowScript = {
        id: crypto.randomUUID(),
        scenarioId: scenario.id,
        generatedAt: new Date().toISOString(),
        turns: generated.turns,
        focusPhrases: generated.focusPhrases,
      };

      await saveShadowScript(nextScript);
      setShadowScript(nextScript);
      return nextScript;
    },
    [scenario, shadowScript, userProfile]
  );

  const handleStartShadow = useCallback(
    async (forceRegenerate: boolean = false) => {
      setError(null);
      setIsShadowLoading(true);

      try {
        await generateAndPersistShadowScript(forceRegenerate);
        setRunMode("shadow");
        setStarted(true);
      } catch (err) {
        console.error("Error preparing shadow session:", err);
        setError(err instanceof Error ? err.message : t("shadow.generateFailed"));
      } finally {
        setIsShadowLoading(false);
      }
    },
    [generateAndPersistShadowScript, t]
  );

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
    setRunMode("conversation");
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

              <div className="flex overflow-hidden rounded-lg border">
                <button
                  type="button"
                  className={`flex-1 py-2 text-sm font-medium transition-colors ${
                    runMode === "conversation"
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted"
                  }`}
                  onClick={() => setRunMode("conversation")}
                >
                  {t("common.conversation")}
                </button>
                <button
                  type="button"
                  className={`flex-1 border-l py-2 text-sm font-medium transition-colors ${
                    runMode === "shadow"
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted"
                  }`}
                  onClick={() => setRunMode("shadow")}
                >
                  {t("shadow.modeLabel")}
                </button>
              </div>

              {runMode === "conversation" ? (
                <Button
                  onClick={handleStartConversation}
                  className="w-full"
                  size="lg"
                  disabled={!ttsStatus.available || vadLoading}
                >
                  {t("scenario.startSession")}
                </Button>
              ) : (
                <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">{t("shadow.previewTitle")}</p>
                    <p className="text-sm text-muted-foreground">{t("shadow.previewDescription")}</p>
                  </div>

                  {shadowScript && (
                    <div className="rounded-lg border bg-background px-3 py-2 text-sm">
                      <p className="font-medium">{t("shadow.cachedScriptReady")}</p>
                      <p className="mt-1 text-muted-foreground">
                        {t("shadow.cachedScriptMeta", {
                          turns: Math.max(1, Math.floor(shadowScript.turns.length / 2)),
                        })}
                      </p>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() => void handleStartShadow(false)}
                      disabled={isShadowLoading}
                    >
                      {isShadowLoading
                        ? <Loader2 className="mr-1 size-4 animate-spin" />
                        : shadowScript
                          ? <RefreshCcw className="mr-1 size-4" />
                          : null}
                      {shadowScript ? t("shadow.replayScript") : t("shadow.startSession")}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void handleStartShadow(true)}
                      disabled={isShadowLoading}
                    >
                      {isShadowLoading ? <Loader2 className="mr-1 size-4 animate-spin" /> : <RefreshCcw className="mr-1 size-4" />}
                      {shadowScript ? t("shadow.regenerateScript") : t("shadow.generateScript")}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (runMode === "shadow" && shadowScript) {
    return (
      <ShadowModeScreen
        scenario={scenario}
        script={shadowScript}
        onRegenerateScript={() => generateAndPersistShadowScript(true)}
        onBackToPreview={() => {
          stopCurrentAudio();
          setStarted(false);
          setError(null);
          setRunMode("shadow");
        }}
        onContextChange={onContextChange}
      />
    );
  }

  // ── Voice mode ──
  if (inputMode === "voice") {
    const hasTranscript = showCaptions && messages.length > 0;

    return (
      <div className="flex h-[calc(100vh-3rem)] flex-col max-w-3xl mx-auto overflow-hidden">
        {error && (
          <Alert variant="destructive" className="mx-4 mt-2 mb-0">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="relative flex-1 min-h-0 overflow-hidden">
          <div
            className={`pointer-events-none absolute inset-x-0 z-0 flex justify-center transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              hasTranscript ? "top-0" : "top-1/2 -translate-y-1/2"
            }`}
          >
            <div
              className={`transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                hasTranscript ? "-translate-y-[58%] scale-[1.78]" : "translate-y-0 scale-100"
              }`}
            >
              <VoiceVisualizer
                amplitude={amplitude}
                isSpeaking={conversationState === "speaking"}
                isListening={conversationState === "listening" && isListening}
                isUserSpeaking={userIsSpeaking}
                isProcessing={conversationState === "transcribing" || conversationState === "thinking"}
                size={hasTranscript ? 168 : 120}
                blur={hasTranscript ? 16 : 3}
              />
            </div>
          </div>

          <div
            className={`relative z-10 flex h-full min-h-0 flex-col px-4 transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              hasTranscript ? "pt-3 opacity-100" : "pt-10 opacity-0 pointer-events-none"
            }`}
          >
            <div className="flex-1 min-h-0">
              <TranscriptBubbles messages={messages} visibleCount={4} />
            </div>
          </div>
        </div>

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
    <div className="flex h-[calc(100vh-3rem)] flex-col max-w-3xl mx-auto p-4 overflow-hidden">
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
