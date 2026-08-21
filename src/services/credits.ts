import type { TTSEngineType, VoiceOption } from "./tts";

const DEFAULT_VOICE_NAME = "四国めたん";

export function getVoicevoxAttribution(
  ttsEngine: TTSEngineType,
  selectedVoice: VoiceOption | null
): string {
  const voiceName =
    ttsEngine === "voicevox" && selectedVoice?.speakerName
      ? selectedVoice.speakerName
      : DEFAULT_VOICE_NAME;
  return `VOICEVOX:${voiceName}`;
}
