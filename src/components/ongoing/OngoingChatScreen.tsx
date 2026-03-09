import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { MessageBubble } from "@/components/conversation/MessageBubble";
import { VoiceVisualizer } from "@/components/conversation/VoiceVisualizer";
import { TranscriptBubbles } from "@/components/conversation/TranscriptBubbles";
import { useVADRecorder } from "@/hooks/useVADRecorder";
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
import type { Message, OngoingChat, UserProfile } from "@/types";
import { v4 as uuidv4 } from "uuid";
import { Loader2, ClipboardCheck, LogOut, Send, Mic, Keyboard } from "lucide-react";
import { OngoingFeedbackDialog } from "@/components/ongoing/OngoingFeedbackDialog";

type InputMode = "text" | "voice";

interface OngoingChatScreenProps {
  chatId: string;
  onBack: () => void;
}

export function OngoingChatScreen({ chatId, onBack }: OngoingChatScreenProps) {
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
      <div className="flex flex-col h-screen max-w-2xl mx-auto overflow-hidden">
        {error && (
          <Alert variant="destructive" className="mx-4 mt-2 mb-0">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className={`flex flex-col items-center justify-center ${hasTranscript ? "py-6 flex-shrink-0" : "flex-1 min-h-0"}`}>
          <VoiceVisualizer
            amplitude={amplitude}
            isSpeaking={voiceConvState === "speaking"}
            isListening={voiceConvState === "listening" && isListening}
            isUserSpeaking={userIsSpeaking}
            isProcessing={voiceConvState === "transcribing" || voiceConvState === "thinking"}
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
    <div className="flex flex-col h-screen max-w-2xl mx-auto p-4 overflow-hidden">
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto mb-4 border rounded-lg">
        <div className="space-y-4 p-4">
          {chat.summary && messages.length === 0 && (
            <div className="text-center py-4">
              <p className="text-sm text-muted-foreground italic">
                Previous conversation history loaded
              </p>
            </div>
          )}

          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} isSpeaking={message.id === speakingMessageId} />
          ))}

          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-lg px-4 py-2">
                <p className="text-muted-foreground">...</p>
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
          placeholder={`Message ${chat.name}...`}
          disabled={isLoading}
          className="flex-1"
        />
        <Button type="submit" disabled={isLoading} size="icon" title="Send">
          <Send className="size-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={handleSwitchToVoice}
          title="Switch to voice"
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
        >
          <ClipboardCheck className="size-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={handleEndSession}
          title="End session"
        >
          <LogOut className="size-4" />
        </Button>
      </form>

      <OngoingFeedbackDialog
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
        messages={feedbackMessages}
        chatName={chat.name}
        chatPersona={chat.persona}
        onFeedbackGenerated={handleFeedbackGenerated}
      />
    </div>
  );
}
