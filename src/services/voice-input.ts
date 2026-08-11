export type VoiceInputMode = "automatic" | "push-to-talk";

const VOICE_INPUT_MODE_KEY = "tama_voice_input_mode";

export function getVoiceInputMode(): VoiceInputMode {
  return localStorage.getItem(VOICE_INPUT_MODE_KEY) === "push-to-talk"
    ? "push-to-talk"
    : "automatic";
}

export function setVoiceInputMode(mode: VoiceInputMode): void {
  localStorage.setItem(VOICE_INPUT_MODE_KEY, mode);
  window.dispatchEvent(new Event("tama-config-changed"));
}
