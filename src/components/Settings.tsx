import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useI18n } from "@/i18n";
import { ChevronDown } from "lucide-react";
import {
  getApiKey,
  setApiKey,
  clearApiKey,
  getLLMProvider,
  setLLMProvider,
  getOpenRouterApiKey,
  setOpenRouterApiKey,
  clearOpenRouterApiKey,
  getOpenRouterModel,
  setOpenRouterModel,
  type LLMProvider as LLMProviderType,
} from "@/services/claude";
import {
  getOpenAIApiKey,
  setOpenAIApiKey,
  clearOpenAIApiKey,
} from "@/services/openai";
import {
  type TTSEngineType,
  type VoiceOption,
  getStoredEngineType,
  setStoredEngineType,
  getDefaultVoiceId,
  setDefaultVoiceId,
  getAllVoiceOptions,
  getEngine,
  speak,
} from "@/services/tts";
import {
  type TranscriptionEngine,
  getTranscriptionEngine,
  setTranscriptionEngine,
} from "@/services/transcription";
import {
  getWhisperModelStatus,
  loadWhisperModel,
  deleteWhisperModel,
  type WhisperModelStatus,
  type DownloadProgress,
} from "@/services/whisper-local";
import { VoicevoxControl } from "@/components/VoicevoxControl";
import { SBV2Control } from "@/components/SBV2Control";
import { clearAllData, getUserProfile, updateUserProfile } from "@/services/storage";
import {
  type DisplayMode,
  getDisplayMode,
  setDisplayMode,
} from "@/services/display";
import { setApiOnboardingDismissed } from "@/services/app-config";
import type { JLPTLevel, ResponseLength } from "@/types";

const DISPLAY_MODE_OPTIONS: { value: DisplayMode; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

interface SpeakerGroup {
  speakerName: string;
  englishName: string;
  styles: VoiceOption[];
}

const SPEAKER_ENGLISH_NAMES: Record<string, string> = {
  "四国めたん": "Shikoku Metan",
  "ずんだもん": "Zundamon",
  "春日部つむぎ": "Kasukabe Tsumugi",
  "雨晴はう": "Amehare Hau",
  "波音リツ": "Namine Ritsu",
  "玄野武宏": "Kurono Takehiro",
  "白上虎太郎": "Shirakami Kotaro",
  "青山龍星": "Aoyama Ryusei",
  "冥鳴ひまり": "Meimei Himari",
  "九州そら": "Kyushu Sora",
  "もち子さん": "Mochiko-san",
  "剣崎雌雄": "Kenzaki Mesuo",
  "WhiteCUL": "WhiteCUL",
  "後鬼": "Goki",
  "No.7": "No.7",
  "ちび式じい": "Chibishiki Jii",
  "櫻歌ミコ": "Ohka Miko",
  "小夜/SAYO": "Sayo",
  "ナースロボ＿タイプＴ": "Nurse Robot Type T",
  "†聖騎士 紅桜†": "Holy Knight Benisakura",
  "雀松朱司": "Suzumatsu Akashi",
  "麒ヶ島宗麟": "Kigashima Sourin",
  "猫使アル": "Nekotsukai Aru",
  "猫使ビィ": "Nekotsukai Bii",
};

const STYLE_ENGLISH_NAMES: Record<string, string> = {
  "ノーマル": "Normal",
  "あまあま": "Sweet",
  "ツンツン": "Tsundere",
  "セクシー": "Sexy",
  "ささやき": "Whisper",
  "ヒソヒソ": "Hushed",
  "怒り": "Angry",
  "悲しみ": "Sad",
  "やさしい": "Gentle",
  "かなしい": "Sad",
  "びえーん": "Crying",
  "ヘロヘロ": "Exhausted",
  "なみだめ": "Teary",
};

const SELECT_CLASSNAME =
  "h-9 w-full appearance-none rounded-md border border-input bg-transparent px-3 py-1 pr-10 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]";

function groupVoicesBySpeaker(voices: VoiceOption[]): SpeakerGroup[] {
  const groups = new Map<string, VoiceOption[]>();

  for (const voice of voices) {
    const existing = groups.get(voice.speakerName) ?? [];
    existing.push(voice);
    groups.set(voice.speakerName, existing);
  }

  return Array.from(groups.entries()).map(([speakerName, styles]) => ({
    speakerName,
    englishName: SPEAKER_ENGLISH_NAMES[speakerName] ?? speakerName,
    styles,
  }));
}

export function Settings() {
  const { locale, setLocale, t } = useI18n();
  const [anthropicKey, setAnthropicKeyState] = useState("");
  const [openaiKey, setOpenaiKeyState] = useState("");
  const [openrouterKey, setOpenrouterKeyState] = useState("");
  const [openrouterModel, setOpenrouterModelState] = useState("");
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [showOpenaiKey, setShowOpenaiKey] = useState(false);
  const [showOpenrouterKey, setShowOpenrouterKey] = useState(false);
  const [llmProvider, setLlmProviderState] = useState<LLMProviderType>(getLLMProvider());
  const [jlptLevel, setJlptLevel] = useState<JLPTLevel>("N5");
  const [autoAdjust, setAutoAdjust] = useState(false);
  const [responseLength, setResponseLengthState] = useState<ResponseLength>("natural");
  const [includeFlashcardVocab, setIncludeFlashcardVocab] = useState(true);
  const [displayMode, setDisplayModeState] = useState<DisplayMode>(getDisplayMode());
  const [profileName, setProfileName] = useState("");
  const [profileAge, setProfileAge] = useState("");
  const [profileAboutYou, setProfileAboutYou] = useState("");
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  
  // TTS engine settings
  const [ttsEngine, setTtsEngine] = useState<TTSEngineType>(getStoredEngineType());
  const [engineAvailable, setEngineAvailable] = useState(false);
  const [voiceOptions, setVoiceOptions] = useState<VoiceOption[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>(getDefaultVoiceId());
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [testingVoice, setTestingVoice] = useState(false);

  // Transcription engine state
  const [transcriptionEngine, setTranscriptionEngineState] = useState<TranscriptionEngine>(getTranscriptionEngine());
  const [whisperStatus, setWhisperStatus] = useState<WhisperModelStatus | null>(null);
  const [whisperDownloading, setWhisperDownloading] = useState(false);
  const [whisperProgress, setWhisperProgress] = useState<DownloadProgress | null>(null);
  const [whisperDeleting, setWhisperDeleting] = useState(false);

  const jlptLevels = useMemo(
    () => [
      { value: "N5" as const, label: t("settings.jlptN5Label"), description: t("settings.jlptN5Description") },
      { value: "N4" as const, label: t("settings.jlptN4Label"), description: t("settings.jlptN4Description") },
      { value: "N3" as const, label: t("settings.jlptN3Label"), description: t("settings.jlptN3Description") },
      { value: "N2" as const, label: t("settings.jlptN2Label"), description: t("settings.jlptN2Description") },
      { value: "N1" as const, label: t("settings.jlptN1Label"), description: t("settings.jlptN1Description") },
    ],
    [t]
  );

  const selectedJlptInfo = useMemo(
    () => jlptLevels.find((level) => level.value === jlptLevel),
    [jlptLevel, jlptLevels]
  );

  const speakerGroups = useMemo(
    () => groupVoicesBySpeaker(voiceOptions),
    [voiceOptions]
  );

  const selectedVoice = useMemo(
    () => voiceOptions.find((voice) => voice.id === selectedVoiceId) ?? null,
    [voiceOptions, selectedVoiceId]
  );

  const selectedSpeakerName = useMemo(() => {
    if (speakerGroups.length === 0) return "";
    const preferred = selectedVoice?.speakerName;
    if (preferred && speakerGroups.some((group) => group.speakerName === preferred)) {
      return preferred;
    }
    return speakerGroups[0].speakerName;
  }, [speakerGroups, selectedVoice]);

  const selectedSpeaker = useMemo(
    () => speakerGroups.find((group) => group.speakerName === selectedSpeakerName) ?? null,
    [speakerGroups, selectedSpeakerName]
  );

  const selectedStyleId = useMemo(() => {
    if (!selectedSpeaker || selectedSpeaker.styles.length === 0) return "";
    const hasSelectedStyle = selectedSpeaker.styles.some((style) => style.id === selectedVoiceId);
    return hasSelectedStyle ? selectedVoiceId : selectedSpeaker.styles[0].id;
  }, [selectedSpeaker, selectedVoiceId]);

  useEffect(() => {
    const existingAnthropicKey = getApiKey();
    const existingOpenaiKey = getOpenAIApiKey();
    const existingOpenrouterKey = getOpenRouterApiKey();

    if (existingAnthropicKey) setAnthropicKeyState(existingAnthropicKey);
    if (existingOpenaiKey) setOpenaiKeyState(existingOpenaiKey);
    if (existingOpenrouterKey) setOpenrouterKeyState(existingOpenrouterKey);
    setOpenrouterModelState(getOpenRouterModel());
    setLlmProviderState(getLLMProvider());
    setSelectedVoiceId(getDefaultVoiceId());
    setTtsEngine(getStoredEngineType());

    getUserProfile().then((profile) => {
      setJlptLevel(profile.jlpt_level);
      setAutoAdjust(profile.auto_adjust_level);
      setResponseLengthState(profile.response_length ?? "natural");
      setIncludeFlashcardVocab(profile.include_flashcard_vocab_in_conversations ?? true);
      setProfileName(profile.name ?? "");
      setProfileAge(profile.age !== undefined ? String(profile.age) : "");
      setProfileAboutYou(profile.aboutYou ?? "");
    });
  }, []);

  // Load Whisper model status
  const refreshWhisperStatus = useCallback(async () => {
    try {
      const status = await getWhisperModelStatus();
      setWhisperStatus(status);
    } catch (err) {
      console.error("Failed to get whisper status:", err);
    }
  }, []);

  useEffect(() => {
    refreshWhisperStatus();
  }, [refreshWhisperStatus]);

  const handleTranscriptionEngineChange = (engine: TranscriptionEngine) => {
    setTranscriptionEngineState(engine);
    setTranscriptionEngine(engine);
    setMessage({
      type: "success",
      text: t("settings.speechRecognitionSet", {
        engine: engine === "local" ? "Local Whisper" : "OpenAI API",
      }),
    });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleDownloadWhisperModel = async () => {
    setWhisperDownloading(true);
    setWhisperProgress(null);
    try {
      await loadWhisperModel((progress) => setWhisperProgress(progress));
      await refreshWhisperStatus();
      setMessage({ type: "success", text: t("settings.whisperDownloaded") });
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      console.error("Failed to download whisper model:", err);
      setMessage({ type: "error", text: t("settings.whisperDownloadFailed") });
      setTimeout(() => setMessage(null), 5000);
    } finally {
      setWhisperDownloading(false);
      setWhisperProgress(null);
    }
  };

  const handleDeleteWhisperModel = async () => {
    if (!window.confirm(t("settings.deleteWhisperConfirm"))) return;
    setWhisperDeleting(true);
    try {
      await deleteWhisperModel();
      await refreshWhisperStatus();
      setMessage({ type: "success", text: t("settings.whisperDeleted") });
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      console.error("Failed to delete whisper model:", err);
      setMessage({ type: "error", text: t("settings.whisperDeleteFailed") });
      setTimeout(() => setMessage(null), 5000);
    } finally {
      setWhisperDeleting(false);
    }
  };

  // Load available voices when VOICEVOX is available
  const loadVoices = useCallback(async () => {
    setLoadingVoices(true);
    try {
      const engine = getEngine(ttsEngine);
      const available = await engine.checkStatus();
      setEngineAvailable(available);

      if (available) {
        const options = await getAllVoiceOptions();
        setVoiceOptions(options);
        setSelectedVoiceId(getDefaultVoiceId());
      } else {
        setVoiceOptions([]);
      }
    } catch (err) {
      console.error("Failed to load voices:", err);
    } finally {
      setLoadingVoices(false);
    }
  }, [ttsEngine]);

  useEffect(() => {
    loadVoices();
  }, [loadVoices]);

  const handleVoiceChange = (voiceId: string) => {
    setSelectedVoiceId(voiceId);
    setDefaultVoiceId(voiceId);
    const voice = voiceOptions.find((v) => v.id === voiceId);
    if (voice) {
      setMessage({ type: "success", text: t("settings.voiceChanged", { name: voice.name }) });
      setTimeout(() => setMessage(null), 3000);
    }
  };

  const handleSpeakerChange = (speakerName: string) => {
    const group = speakerGroups.find((entry) => entry.speakerName === speakerName);
    if (!group || group.styles.length === 0) return;

    const preferredStyleName = selectedVoice?.styleName;
    const nextVoice =
      group.styles.find((style) => style.styleName === preferredStyleName) ??
      group.styles[0];

    handleVoiceChange(nextVoice.id);
  };

  const handleEngineChange = (engine: TTSEngineType) => {
    setTtsEngine(engine);
    setStoredEngineType(engine);
    setEngineAvailable(false);
    setVoiceOptions([]);
    setMessage({
      type: "success",
      text: t("settings.ttsEngineSet", {
        engine: engine === "voicevox" ? "VOICEVOX" : "Style-Bert-VITS2",
      }),
    });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleTestVoice = async () => {
    if (testingVoice) return;
    setTestingVoice(true);
    try {
      await speak("こんにちは！私はあなたの日本語の練習相手です。", {
        voiceId: selectedVoiceId,
      });
    } catch (err) {
      console.error("Failed to test voice:", err);
      setMessage({ type: "error", text: t("settings.testAudioFailed") });
      setTimeout(() => setMessage(null), 3000);
    } finally {
      setTestingVoice(false);
    }
  };

  const handleJlptChange = async (level: JLPTLevel) => {
    setJlptLevel(level);
    await updateUserProfile({ jlpt_level: level });
    setMessage({ type: "success", text: t("settings.jlptSet", { level }) });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleAutoAdjustChange = async (enabled: boolean) => {
    setAutoAdjust(enabled);
    await updateUserProfile({ auto_adjust_level: enabled });
  };

  const handleResponseLengthChange = async (length: ResponseLength) => {
    setResponseLengthState(length);
    await updateUserProfile({ response_length: length });
    const labels: Record<ResponseLength, string> = {
      short: t("settings.responseShort"),
      natural: t("settings.responseNatural"),
      long: t("settings.responseLong"),
    };
    setMessage({ type: "success", text: t("settings.responseLengthSet", { label: labels[length] }) });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleIncludeFlashcardVocabChange = async (enabled: boolean) => {
    setIncludeFlashcardVocab(enabled);
    await updateUserProfile({ include_flashcard_vocab_in_conversations: enabled });
    setMessage({
      type: "success",
      text: enabled
        ? t("settings.scenarioReviewEnabled")
        : t("settings.scenarioReviewDisabled"),
    });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleDisplayModeChange = (mode: DisplayMode) => {
    setDisplayModeState(mode);
    setDisplayMode(mode);
    const labels: Record<DisplayMode, string> = {
      light: t("settings.light"),
      dark: t("settings.dark"),
      system: t("settings.system"),
    };
    setMessage({ type: "success", text: t("settings.displayModeSet", { label: labels[mode] }) });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleSavePersonalContext = async () => {
    const trimmedName = profileName.trim();
    const trimmedAbout = profileAboutYou.trim();
    const trimmedAge = profileAge.trim();

    if (trimmedAge && !/^\d+$/.test(trimmedAge)) {
      setMessage({ type: "error", text: t("settings.ageWholeNumber") });
      setTimeout(() => setMessage(null), 3000);
      return;
    }

    const parsedAge = trimmedAge ? Number(trimmedAge) : undefined;
    await updateUserProfile({
      name: trimmedName || undefined,
      age: parsedAge,
      aboutYou: trimmedAbout || undefined,
    });
    setMessage({ type: "success", text: t("settings.personalContextSaved") });
    setTimeout(() => setMessage(null), 3000);
  };

  const maskKey = (key: string) => {
    if (!key) return "";
    if (key.length <= 8) return "••••••••";
    return key.slice(0, 7) + "••••••••" + key.slice(-4);
  };

  const handleLLMProviderChange = (provider: LLMProviderType) => {
    setLlmProviderState(provider);
    setLLMProvider(provider);
    setMessage({
      type: "success",
      text: t("settings.llmProviderSet", {
        provider: provider === "anthropic" ? "Anthropic (direct)" : "OpenRouter",
      }),
    });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleSaveAnthropicKey = () => {
    const trimmed = anthropicKey.trim();
    if (!trimmed) {
      setMessage({ type: "error", text: t("settings.enterAnthropicKey") });
      return;
    }
    if (!trimmed.startsWith("sk-ant-")) {
      setMessage({
        type: "error",
        text: t("settings.invalidAnthropicKey"),
      });
      return;
    }
    setApiKey(trimmed);
    setMessage({ type: "success", text: t("settings.anthropicSaved") });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleSaveOpenrouterKey = () => {
    const trimmed = openrouterKey.trim();
    if (!trimmed) {
      setMessage({ type: "error", text: t("settings.enterOpenRouterKey") });
      return;
    }
    if (!trimmed.startsWith("sk-or-")) {
      setMessage({
        type: "error",
        text: t("settings.invalidOpenRouterKey"),
      });
      return;
    }
    setOpenRouterApiKey(trimmed);
    setMessage({ type: "success", text: t("settings.openRouterSaved") });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleSaveOpenrouterModel = () => {
    const trimmed = openrouterModel.trim();
    if (!trimmed) {
      setMessage({ type: "error", text: t("settings.enterModelName") });
      return;
    }
    setOpenRouterModel(trimmed);
    setMessage({ type: "success", text: t("settings.modelSet", { name: trimmed }) });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleSaveOpenaiKey = () => {
    const trimmed = openaiKey.trim();
    if (!trimmed) {
      setMessage({ type: "error", text: t("settings.enterOpenAiKey") });
      return;
    }
    if (!trimmed.startsWith("sk-")) {
      setMessage({
        type: "error",
        text: t("settings.invalidOpenAiKey"),
      });
      return;
    }
    setOpenAIApiKey(trimmed);
    setMessage({ type: "success", text: t("settings.openAiSaved") });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleClearAllData = async () => {
    if (
      window.confirm(t("settings.clearAllConfirm"))
    ) {
      await clearAllData();
      setAnthropicKeyState("");
      setOpenaiKeyState("");
      setOpenrouterKeyState("");
      setDisplayMode("system");
      setDisplayModeState("system");
      setIncludeFlashcardVocab(true);
      setProfileName("");
      setProfileAge("");
      setProfileAboutYou("");
      setMessage({ type: "success", text: t("settings.allDataCleared") });
      setApiOnboardingDismissed(false);
      clearApiKey();
      clearOpenAIApiKey();
      clearOpenRouterApiKey();
    }
  };

  return (
    <div className="h-full bg-background p-4 overflow-auto">
      <div className="max-w-lg mx-auto space-y-6 pb-4">
        {/* Toast message — fixed position so it doesn't shift layout */}
        {message && (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-2 duration-200">
            <div
              className={`px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium ${
                message.type === "success"
                  ? "bg-primary text-primary-foreground"
                  : "bg-red-600 text-white"
              }`}
            >
              {message.text}
            </div>
          </div>
        )}

        {/* Personal Context */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("settings.personalContext")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("settings.personalContextDescription")}
            </p>

            <div className="space-y-1.5">
              <label htmlFor="profile-name" className="text-sm font-medium">{t("settings.name")}</label>
              <Input
                id="profile-name"
                placeholder={t("settings.namePlaceholder")}
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="profile-age" className="text-sm font-medium">{t("settings.age")}</label>
              <Input
                id="profile-age"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder={t("settings.agePlaceholder")}
                value={profileAge}
                onChange={(e) => setProfileAge(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="profile-about-you" className="text-sm font-medium">{t("settings.aboutYou")}</label>
              <Textarea
                id="profile-about-you"
                rows={3}
                placeholder={t("settings.aboutYouPlaceholder")}
                value={profileAboutYou}
                onChange={(e) => setProfileAboutYou(e.target.value)}
              />
            </div>

            <div className="flex justify-end">
              <Button onClick={handleSavePersonalContext}>{t("common.save")}</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("settings.languageSection")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("settings.languageDescription")}
            </p>
            <div className="relative">
              <select
                id="app-language-select"
                value={locale}
                onChange={(e) => setLocale(e.target.value as "en" | "es")}
                className={SELECT_CLASSNAME}
              >
                <option value="en">{t("common.english")}</option>
                <option value="es">{t("common.spanish")}</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-foreground/80" />
            </div>
          </CardContent>
        </Card>

        {/* Display */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("settings.display")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("settings.displayDescription")}
            </p>

            <div className="flex rounded-lg border overflow-hidden">
              {DISPLAY_MODE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                    displayMode === opt.value
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted"
                  }`}
                  onClick={() => handleDisplayModeChange(opt.value)}
                >
                  {opt.value === "light"
                    ? t("settings.light")
                    : opt.value === "dark"
                      ? t("settings.dark")
                      : t("settings.system")}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* JLPT Level */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("settings.jlptLevel")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("settings.jlptDescription")}
            </p>

            <div className="space-y-1.5">
              <label htmlFor="jlpt-level-select" className="text-sm font-medium">
                {t("settings.currentLevel")}
              </label>
              <div className="relative">
                <select
                  id="jlpt-level-select"
                  value={jlptLevel}
                  onChange={(e) => handleJlptChange(e.target.value as JLPTLevel)}
                  className={SELECT_CLASSNAME}
                >
                  {jlptLevels.map((level) => (
                    <option key={level.value} value={level.value}>
                      {level.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-foreground/80" />
              </div>
              {selectedJlptInfo && (
                <p className="text-xs text-muted-foreground">{selectedJlptInfo.description}</p>
              )}
            </div>

            <div className="flex items-center gap-3 pt-2">
              <input
                type="checkbox"
                id="autoAdjust"
                checked={autoAdjust}
                onChange={(e) => handleAutoAdjustChange(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              <label htmlFor="autoAdjust" className="text-sm">
                {t("settings.autoAdjust")}
              </label>
            </div>
          </CardContent>
        </Card>

        {/* Response Length */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("settings.responseLength")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("settings.responseLengthDescription")}
            </p>

            <div className="flex rounded-lg border overflow-hidden">
              {(
                [
                  { value: "short" as const, label: "Short" },
                  { value: "natural" as const, label: "Natural" },
                  { value: "long" as const, label: "Long" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                    responseLength === opt.value
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted"
                  }`}
                  onClick={() => handleResponseLengthChange(opt.value)}
                >
                  {opt.value === "short"
                    ? t("settings.responseShort")
                    : opt.value === "natural"
                      ? t("settings.responseNatural")
                      : t("settings.responseLong")}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Scenario Vocabulary Review */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("settings.scenarioVocabularyReview")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("settings.scenarioVocabularyDescription")}
            </p>

            <div className="flex items-center gap-3 pt-1">
              <input
                type="checkbox"
                id="includeFlashcardVocab"
                checked={includeFlashcardVocab}
                onChange={(e) => handleIncludeFlashcardVocabChange(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              <label htmlFor="includeFlashcardVocab" className="text-sm">
                {t("settings.scenarioVocabularyToggle")}
              </label>
            </div>
          </CardContent>
        </Card>

        {/* LLM Provider */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("settings.llmProvider")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("settings.llmDescription")}
            </p>

            <div className="flex rounded-lg border overflow-hidden">
              <button
                className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                  llmProvider === "anthropic"
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                }`}
                onClick={() => handleLLMProviderChange("anthropic")}
              >
                Anthropic
              </button>
              <button
                className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                  llmProvider === "openrouter"
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                }`}
                onClick={() => handleLLMProviderChange("openrouter")}
              >
                OpenRouter
              </button>
            </div>

            {llmProvider === "anthropic" ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {t("settings.anthropicDescription")}{" "}
                  <a
                    href="https://console.anthropic.com/settings/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-foreground"
                  >
                    Get key
                  </a>
                </p>
                <div className="flex gap-2">
                  <Input
                    type={showAnthropicKey ? "text" : "password"}
                    placeholder="sk-ant-..."
                    value={showAnthropicKey ? anthropicKey : maskKey(anthropicKey)}
                    onChange={(e) => setAnthropicKeyState(e.target.value)}
                    onFocus={() => setShowAnthropicKey(true)}
                    onBlur={() => setShowAnthropicKey(false)}
                    className="flex-1"
                  />
                  <Button onClick={handleSaveAnthropicKey}>{t("common.save")}</Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {t("settings.openrouterDescription")}{" "}
                  <a
                    href="https://openrouter.ai/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-foreground"
                  >
                    Get key
                  </a>
                </p>
                <div className="flex gap-2">
                  <Input
                    type={showOpenrouterKey ? "text" : "password"}
                    placeholder="sk-or-..."
                    value={showOpenrouterKey ? openrouterKey : maskKey(openrouterKey)}
                    onChange={(e) => setOpenrouterKeyState(e.target.value)}
                    onFocus={() => setShowOpenrouterKey(true)}
                    onBlur={() => setShowOpenrouterKey(false)}
                    className="flex-1"
                  />
                  <Button onClick={handleSaveOpenrouterKey}>{t("common.save")}</Button>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">{t("api.model")}</label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="anthropic/claude-sonnet-4-6"
                      value={openrouterModel}
                      onChange={(e) => setOpenrouterModelState(e.target.value)}
                      className="flex-1"
                    />
                    <Button onClick={handleSaveOpenrouterModel}>{t("common.save")}</Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("settings.modelHelp", { example: "google/gemini-2.0-flash-001" }).split("openrouter.ai/models")[0]}
                    <a
                      href="https://openrouter.ai/models"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-foreground"
                    >
                      openrouter.ai/models
                    </a>
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* TTS Engine */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("settings.ttsEngine")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("settings.ttsDescription")}
            </p>

            <div className="flex rounded-lg border overflow-hidden">
              <button
                className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                  ttsEngine === "voicevox"
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                }`}
                onClick={() => handleEngineChange("voicevox")}
              >
                VOICEVOX
              </button>
              <button
                className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                  ttsEngine === "sbv2"
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                }`}
                onClick={() => handleEngineChange("sbv2")}
              >
                Style-Bert-VITS2
              </button>
            </div>

            {ttsEngine === "voicevox" ? (
              <VoicevoxControl />
            ) : (
              <SBV2Control />
            )}
          </CardContent>
        </Card>

        {/* Voice Selection */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("settings.aiVoice")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("settings.aiVoiceDescription")}
            </p>

            {loadingVoices ? (
              <p className="text-sm text-muted-foreground">{t("settings.loadingVoices")}</p>
            ) : !engineAvailable ? (
              <Alert>
                <AlertDescription>
                  {ttsEngine === "voicevox"
                    ? t("settings.voicevoxNotRunning")
                    : t("settings.sbv2NotRunning")}
                </AlertDescription>
              </Alert>
            ) : voiceOptions.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("settings.noVoices")}</p>
            ) : (
              <>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label htmlFor="voice-speaker-select" className="text-sm font-medium">
                      {t("settings.voiceLabel")}
                    </label>
                    <div className="relative">
                      <select
                        id="voice-speaker-select"
                        value={selectedSpeakerName}
                        onChange={(e) => handleSpeakerChange(e.target.value)}
                        className={SELECT_CLASSNAME}
                      >
                        {speakerGroups.map((group) => (
                          <option key={group.speakerName} value={group.speakerName}>
                            {group.englishName !== group.speakerName
                              ? `${group.englishName} (${group.speakerName})`
                              : group.englishName}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-foreground/80" />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="voice-style-select" className="text-sm font-medium">
                      {t("settings.styleLabel")}
                    </label>
                    <div className="relative">
                      <select
                        id="voice-style-select"
                        value={selectedStyleId}
                        onChange={(e) => handleVoiceChange(e.target.value)}
                        className={SELECT_CLASSNAME}
                        disabled={!selectedSpeaker || selectedSpeaker.styles.length === 0}
                      >
                        {selectedSpeaker?.styles.map((voice) => {
                          const styleEn = STYLE_ENGLISH_NAMES[voice.styleName];
                          return (
                            <option key={voice.id} value={voice.id}>
                              {styleEn && styleEn !== voice.styleName
                                ? `${styleEn} (${voice.styleName})`
                                : voice.styleName}
                            </option>
                          );
                        })}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-foreground/80" />
                    </div>
                  </div>

                  {selectedVoice && (
                    <p className="text-xs text-muted-foreground">
                      {t("settings.selectedVoice", { name: selectedVoice.name })}
                    </p>
                  )}
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={handleTestVoice}
                    disabled={testingVoice}
                    className="flex-1"
                  >
                    {testingVoice ? t("settings.playing") : t("settings.testVoice")}
                  </Button>
                  <Button variant="ghost" onClick={loadVoices} disabled={loadingVoices}>
                    {t("common.refresh")}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Speech Recognition */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t("settings.speechRecognition")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("settings.speechRecognitionDescription")}
            </p>

            <div className="flex rounded-lg border overflow-hidden">
              <button
                className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                  transcriptionEngine === "local"
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                }`}
                onClick={() => handleTranscriptionEngineChange("local")}
              >
                Local Whisper
              </button>
              <button
                className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                  transcriptionEngine === "openai"
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                }`}
                onClick={() => handleTranscriptionEngineChange("openai")}
              >
                OpenAI API
              </button>
            </div>

            {transcriptionEngine === "local" ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {t("settings.localWhisperDescription")}
                </p>

                {whisperStatus && (
                  <div className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{t("settings.whisperModel")}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        whisperStatus.loaded
                          ? "bg-success-soft text-success-soft-foreground"
                          : whisperStatus.model_exists
                            ? "bg-yellow-100 text-yellow-700"
                            : "bg-gray-100 text-gray-600"
                      }`}>
                        {whisperStatus.loaded ? t("settings.loaded") : whisperStatus.model_exists ? t("settings.downloaded") : t("settings.notDownloaded")}
                      </span>
                    </div>

                    {whisperStatus.model_exists && whisperStatus.model_size_bytes > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {t("settings.sizeMb", {
                          size: (whisperStatus.model_size_bytes / (1024 * 1024)).toFixed(0),
                        })}
                      </p>
                    )}

                    {whisperDownloading && whisperProgress && (
                      <div className="space-y-1">
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all duration-300"
                            style={{ width: `${whisperProgress.percent}%` }}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground text-right">
                          {whisperProgress.percent.toFixed(0)}% — {(whisperProgress.downloaded / (1024 * 1024)).toFixed(0)} / {(whisperProgress.total / (1024 * 1024)).toFixed(0)} MB
                        </p>
                      </div>
                    )}

                    <div className="flex gap-2">
                      {!whisperStatus.model_exists ? (
                        <Button
                          size="sm"
                          onClick={handleDownloadWhisperModel}
                          disabled={whisperDownloading}
                        >
                          {whisperDownloading ? t("settings.downloading") : t("settings.downloadModel")}
                        </Button>
                      ) : !whisperStatus.loaded ? (
                        <Button
                          size="sm"
                          onClick={handleDownloadWhisperModel}
                          disabled={whisperDownloading}
                        >
                          {whisperDownloading ? t("app.loading") : t("settings.loadModel")}
                        </Button>
                      ) : null}
                      {whisperStatus.model_exists && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleDeleteWhisperModel}
                          disabled={whisperDeleting || whisperDownloading}
                        >
                          {whisperDeleting ? t("settings.deleting") : t("settings.deleteModel")}
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {t("settings.openAiDescription")}{" "}
                  <a
                    href="https://platform.openai.com/api-keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-foreground"
                  >
                    Get key
                  </a>
                </p>
                <div className="flex gap-2">
                  <Input
                    type={showOpenaiKey ? "text" : "password"}
                    placeholder="sk-..."
                    value={showOpenaiKey ? openaiKey : maskKey(openaiKey)}
                    onChange={(e) => setOpenaiKeyState(e.target.value)}
                    onFocus={() => setShowOpenaiKey(true)}
                    onBlur={() => setShowOpenaiKey(false)}
                    className="flex-1"
                  />
                  <Button onClick={handleSaveOpenaiKey}>{t("common.save")}</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Danger Zone */}
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-lg text-destructive">{t("settings.dangerZone")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t("settings.dangerDescription")}
            </p>
            <Button variant="destructive" onClick={handleClearAllData}>
              {t("settings.clearAllData")}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
