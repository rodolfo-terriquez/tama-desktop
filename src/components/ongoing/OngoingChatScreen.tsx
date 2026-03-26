import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { MessageBubble } from "@/components/conversation/MessageBubble";
import { VoiceVisualizer } from "@/components/conversation/VoiceVisualizer";
import { TranscriptBubbles } from "@/components/conversation/TranscriptBubbles";
import { useVADRecorder } from "@/hooks/useVADRecorder";
import { buildOngoingChatSenseiViewContext } from "@/services/sensei-context";
import {
  sendMessage,
  buildOngoingChatPrompt,
  getContextMessages,
  summarizeConversation,
  ONGOING_CHAT_SUMMARIZE_THRESHOLD,
  ONGOING_CHAT_KEEP_AFTER_SUMMARIZE,
} from "@/services/claude";
import { initializeTTS, speak, stopCurrentAudio } from "@/services/tts";
import { getOngoingChat, saveOngoingChat, getUserProfile } from "@/services/storage";
import type { Message, OngoingChat, SenseiViewContext, UserProfile } from "@/types";
import { v4 as uuidv4 } from "uuid";
import { ArrowUp, Loader2, ClipboardCheck, LogOut, Mic, Keyboard } from "lucide-react";
import { OngoingFeedbackDialog } from "@/components/ongoing/OngoingFeedbackDialog";

type InputMode = "text" | "voice";

interface OngoingChatScreenProps {
  chatId: string;
  onBack: () => void;
  onContextChange?: (context: SenseiViewContext) => void;
}

export function OngoingChatScreen({ chatId, onBack, onContextChange }: OngoingChatScreenProps) {
  const [chat, setChat] = useState<OngoingChat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ttsAvailable, setTtsAvailable] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [inputMode, setInputMode] = useState<InputMode>("text");
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [draftMessage, setDraftMessage] = useState("");

  // Voice mode state
  const [voiceConvState, setVoiceConvState] = useState<
    "idle" | "listening" | "transcribing" | "thinking" | "speaking"
  >("idle");
  const [amplitude, setAmplitude] = useState(0);
  const [showCaptions, setShowCaptions] = useState(true);

  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<Message[]>([]);
  const sessionEndedRef = useRef(false);

  useEffect(() => { messagesRef.current = messages; }, [messages]);

  useEffect(() => {
    initializeTTS().then((r) => setTtsAvailable(r.available)).catch(() => {});
    getUserProfile().then(setUserProfile);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getOngoingChat(chatId).then((loaded) => {
      if (!cancelled && loaded) {
        setChat(loaded);
        setMessages(loaded.messages);
      }
    });
    return () => { cancelled = true; };
  }, [chatId]);

  useEffect(() => {
    if (inputMode === "text") {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isLoading, inputMode]);

  useEffect(() => {
    if (!chat) return;
    onContextChange?.(
      buildOngoingChatSenseiViewContext({
        chatId: chat.id,
        name: chat.name,
        persona: chat.persona,
        summary: chat.summary,
        inputMode,
        messages,
      })
    );
  }, [chat, inputMode, messages, onContextChange]);

  const persistMessages = useCallback(
    async (updatedMessages: Message[]) => {
      if (!chat) return;
      const updated: OngoingChat = {
        ...chat,
        messages: updatedMessages,
        lastActiveAt: new Date().toISOString(),
        totalMessages: chat.totalMessages + 1,
      };
      setChat(updated);
      await saveOngoingChat(updated);
    },
    [chat]
  );

  const sendAndRespond = useCallback(
    async (text: string) => {
      if (!text.trim() || !chat) return;

      setError(null);
      setIsLoading(true);

      const userMessage: Message = {
        id: uuidv4(),
        role: "user",
        content: text.trim(),
        timestamp: new Date().toISOString(),
      };
      const withUser = [...messagesRef.current, userMessage];
      setMessages(withUser);

      try {
        const profile = userProfile || (await getUserProfile());
        const systemPrompt = buildOngoingChatPrompt(
          chat,
          profile.jlpt_level,
          profile.auto_adjust_level,
          profile.response_length,
          { name: profile.name, age: profile.age, aboutYou: profile.aboutYou }
        );

        const contextMessages = getContextMessages(withUser);
        const response = await sendMessage(contextMessages, systemPrompt);

        if (sessionEndedRef.current) return;

        const assistantMessage: Message = {
          id: uuidv4(),
          role: "assistant",
          content: response,
          timestamp: new Date().toISOString(),
        };

        const withAssistant = [...withUser, assistantMessage];
        setMessages(withAssistant);

        const updated: OngoingChat = {
          ...chat,
          messages: withAssistant,
          lastActiveAt: new Date().toISOString(),
          totalMessages: chat.totalMessages + 2,
        };
        setChat(updated);
        await saveOngoingChat(updated);

        return { assistantMessage, response };
      } catch (err) {
        console.error("Error sending message:", err);
        setError(err instanceof Error ? err.message : "Failed to send message");
        await persistMessages(withUser);
        return undefined;
      } finally {
        setIsLoading(false);
      }
    },
    [chat, persistMessages, userProfile]
  );

  // --- Text mode handler ---
  const handleTextSubmit = useCallback(
    async (text: string) => {
      const result = await sendAndRespond(text);
      if (result && ttsAvailable) {
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
    [sendAndRespond, ttsAvailable]
  );

  // --- Voice mode handler ---
  const handleVoiceTranscription = useCallback(
    async (transcript: string) => {
      if (sessionEndedRef.current) return;
      if (!transcript?.trim()) {
        setVoiceConvState("listening");
        return;
      }

      setVoiceConvState("thinking");
      const result = await sendAndRespond(transcript);

      if (sessionEndedRef.current) return;

      if (result && ttsAvailable) {
        setVoiceConvState("speaking");
        try {
          await speak(result.response, { onAmplitude: setAmplitude });
        } catch (err) {
          console.error("TTS error:", err);
        }
      }

      if (sessionEndedRef.current) return;
      setVoiceConvState("listening");
      setAmplitude(0);
    },
    [sendAndRespond, ttsAvailable]
  );

  const {
    isListening,
    isSpeaking: userIsSpeaking,
    start: startVAD,
    stop: stopVAD,
    pause: pauseVAD,
    resume: resumeVAD,
  } = useVADRecorder({
    onSpeechStart: () => {
      if (voiceConvState === "speaking") {
        stopCurrentAudio();
        setVoiceConvState("listening");
      }
    },
    onSpeechEnd: () => {
      setVoiceConvState("transcribing");
    },
    onTranscription: handleVoiceTranscription,
    onAmplitude: setAmplitude,
  });

  useEffect(() => {
    if (inputMode !== "voice") return;
    if (voiceConvState === "listening" && isListening) {
      resumeVAD();
    } else if (voiceConvState !== "listening" && isListening) {
      pauseVAD();
    }
  }, [voiceConvState, inputMode, isListening, pauseVAD, resumeVAD]);

  const handleSwitchToVoice = useCallback(async () => {
    setInputMode("voice");
    setVoiceConvState("listening");
    await startVAD();
  }, [startVAD]);

  const handleSwitchToText = useCallback(() => {
    stopVAD();
    stopCurrentAudio();
    setInputMode("text");
    setVoiceConvState("idle");
    setAmplitude(0);
  }, [stopVAD]);

  const handleEndSession = useCallback(async () => {
    if (!chat) { onBack(); return; }

    sessionEndedRef.current = true;
    stopVAD();
    stopCurrentAudio();

    if (messagesRef.current.length > ONGOING_CHAT_SUMMARIZE_THRESHOLD) {
      setIsSummarizing(true);
      try {
        const messagesToSummarize = messagesRef.current.slice(
          0, messagesRef.current.length - ONGOING_CHAT_KEEP_AFTER_SUMMARIZE
        );
        const keptMessages = messagesRef.current.slice(-ONGOING_CHAT_KEEP_AFTER_SUMMARIZE);
        const newSummary = await summarizeConversation(chat.summary, messagesToSummarize);
        await saveOngoingChat({
          ...chat, messages: keptMessages, summary: newSummary,
          lastActiveAt: new Date().toISOString(),
        });
      } catch (err) {
        console.error("Summarization failed:", err);
        await saveOngoingChat({
          ...chat, messages: messagesRef.current,
          lastActiveAt: new Date().toISOString(),
        });
      } finally {
        setIsSummarizing(false);
      }
    } else {
      await saveOngoingChat({
        ...chat, messages: messagesRef.current,
        lastActiveAt: new Date().toISOString(),
      });
    }
    onBack();
  }, [chat, onBack, stopVAD]);

  const newMessageCount = chat ? chat.totalMessages - (chat.lastFeedbackAtTotal ?? 0) : 0;
  const feedbackMessages = chat
    ? messages.slice(-Math.min(newMessageCount, messages.length))
    : [];
  const hasFeedbackMessages = feedbackMessages.length > 0 && feedbackMessages.some(m => m.role === "user");

  const handleFeedbackGenerated = useCallback(async () => {
    if (!chat) return;
    const updated: OngoingChat = { ...chat, lastFeedbackAtTotal: chat.totalMessages };
    setChat(updated);
    await saveOngoingChat(updated);
  }, [chat]);

  if (!chat) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Chat not found</p>
      </div>
    );
  }

  if (isSummarizing) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Summarizing conversation history...</p>
      </div>
    );
  }

  // ── Voice mode layout ──
  if (inputMode === "voice") {
    const hasTranscript = showCaptions && messages.length > 0;

    return (
      <div className="flex flex-col h-screen max-w-3xl mx-auto overflow-hidden">
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
                isSpeaking={voiceConvState === "speaking"}
                isListening={voiceConvState === "listening" && isListening}
                isUserSpeaking={userIsSpeaking}
                isProcessing={voiceConvState === "transcribing" || voiceConvState === "thinking"}
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
            {showCaptions ? "Hide Transcript" : "Show Transcript"}
          </Button>
          <Button variant="ghost" size="sm" onClick={handleSwitchToText}>
            <Keyboard className="size-4 mr-1" />
            Text
          </Button>
          <Button variant="outline" size="sm" onClick={handleEndSession}>
            End Session
          </Button>
        </div>
      </div>
    );
  }

  // ── Text mode layout ──
  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden bg-background">
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1">
        <div className="relative flex min-h-0 flex-1 flex-col">
      {error && (
        <Alert variant="destructive" className="mx-4 mt-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 px-4 pt-4 pb-36">
          {chat.summary && messages.length === 0 && (
            <div className="text-center py-4">
              <p className="text-sm text-muted-foreground italic">
                Previous conversation history loaded
              </p>
            </div>
          )}

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

          {messages.length === 0 && !isLoading && (
            <div className="text-center py-8 text-muted-foreground">
              <p className="text-sm">
                {chat.totalMessages > 0
                  ? `Say something to continue your conversation with ${chat.name}`
                  : `Start chatting with ${chat.name}!`}
              </p>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const value = draftMessage.trim();
          if (value) {
            void handleTextSubmit(value);
            setDraftMessage("");
          }
        }}
        className="absolute inset-x-3 bottom-3 z-20"
      >
        <div className="rounded-2xl border border-border/80 bg-background/95 px-3 pt-2.5 pb-2 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/85">
          <Textarea
            placeholder={`Message ${chat.name}...`}
            disabled={isLoading}
            value={draftMessage}
            onChange={(event) => setDraftMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                const value = draftMessage.trim();
                if (value && !isLoading) {
                  void handleTextSubmit(value);
                  setDraftMessage("");
                }
              }
            }}
            className="min-h-[56px] resize-none border-0 bg-transparent px-0 py-0 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <div className="mt-1.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleSwitchToVoice}
                title="Switch to voice"
                className="size-8 rounded-full"
              >
                <Mic className="size-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setFeedbackOpen(true)}
                disabled={!hasFeedbackMessages || isLoading}
                title={hasFeedbackMessages ? "Get feedback on recent messages" : "No new messages to review"}
                className="size-8 rounded-full"
              >
                <ClipboardCheck className="size-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleEndSession}
                title="End session"
                className="size-8 rounded-full"
              >
                <LogOut className="size-4" />
              </Button>
            </div>
            <Button
              type="submit"
              disabled={isLoading || !draftMessage.trim()}
              size="icon"
              title="Send"
              className="size-9 shrink-0 rounded-full"
            >
              <ArrowUp className="size-4" />
            </Button>
          </div>
        </div>
      </form>

      <OngoingFeedbackDialog
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
        chatId={chat.id}
        messages={feedbackMessages}
        chatName={chat.name}
        chatPersona={chat.persona}
        onFeedbackGenerated={handleFeedbackGenerated}
      />
        </div>
      </div>
    </div>
  );
}
