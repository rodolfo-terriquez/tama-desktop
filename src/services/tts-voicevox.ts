/**
 * VOICEVOX TTS engine adapter.
 * Wraps the VOICEVOX REST API (localhost:50021) behind the TTSEngine interface.
 */

import type { TTSEngine, TTSSpeaker } from "./tts";

const VOICEVOX_BASE_URL = "http://localhost:50021";

async function createAudioQuery(
  text: string,
  speakerId: number
): Promise<object> {
  const params = new URLSearchParams({
    text,
    speaker: speakerId.toString(),
  });

  const response = await fetch(
    `${VOICEVOX_BASE_URL}/audio_query?${params.toString()}`,
    { method: "POST" }
  );

  if (!response.ok) {
    throw new Error(`VOICEVOX audio_query failed (${response.status})`);
  }

  return response.json();
}

async function synthesizeFromQuery(
  query: object,
  speakerId: number
): Promise<ArrayBuffer> {
  const params = new URLSearchParams({
    speaker: speakerId.toString(),
  });

  const response = await fetch(
    `${VOICEVOX_BASE_URL}/synthesis?${params.toString()}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(query),
    }
  );

  if (!response.ok) {
    throw new Error(`VOICEVOX synthesis failed (${response.status})`);
  }

  return response.arrayBuffer();
}

export const voicevoxEngine: TTSEngine = {
  name: "VOICEVOX",
  type: "voicevox",

  async checkStatus(): Promise<boolean> {
    try {
      const r = await fetch(`${VOICEVOX_BASE_URL}/version`, { method: "GET" });
      return r.ok;
    } catch {
      return false;
    }
  },

  async getSpeakers(): Promise<TTSSpeaker[]> {
    const r = await fetch(`${VOICEVOX_BASE_URL}/speakers`, { method: "GET" });
    if (!r.ok) throw new Error(`Failed to get VOICEVOX speakers (${r.status})`);

    const raw: { name: string; speaker_uuid: string; styles: { name: string; id: number }[] }[] =
      await r.json();

    return raw.map((s) => ({
      name: s.name,
      id: s.speaker_uuid,
      styles: s.styles.map((st) => ({
        name: st.name,
        id: String(st.id),
      })),
    }));
  },

  async synthesize(text: string, voiceId?: string): Promise<ArrayBuffer> {
    const speakerId = voiceId ? parseInt(voiceId, 10) : 2;
    const query = await createAudioQuery(text, speakerId);
    return synthesizeFromQuery(query, speakerId);
  },
};
