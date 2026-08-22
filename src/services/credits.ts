import {
  DEFAULT_VOICEVOX_SPEAKER_NAME,
  type TTSEngineType,
  type VoiceOption,
} from "./tts";

export function getVoicevoxAttribution(
  ttsEngine: TTSEngineType,
  selectedVoice: VoiceOption | null
): string {
  const voiceName =
    ttsEngine === "voicevox" && selectedVoice?.speakerName
      ? selectedVoice.speakerName
      : DEFAULT_VOICEVOX_SPEAKER_NAME;
  return `VOICEVOX:${voiceName}`;
}
