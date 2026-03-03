/**
 * Style-Bert-VITS2 TTS engine adapter.
 * Wraps the SBV2 REST API behind the TTSEngine interface.
 *
 * SBV2 API:
 *   GET /models/info  → list models/speakers/styles
 *   GET /voice?text=...&model_id=X&speaker_id=Y&style=Z&language=JP → WAV
 */

import type { TTSEngine, TTSSpeaker } from "./tts";
import { getSBV2BaseUrl } from "./tts";

/**
 * Build a direct URL to the local SBV2 server.
 * In Tauri, the webview can access localhost directly (no CORS restrictions).
 */
function directUrl(path: string): string {
  const base = getSBV2BaseUrl().replace(/\/+$/, "");
  return `${base}${path}`;
}

/**
 * Voice IDs are encoded as "modelId:speakerName:styleName"
 * so we can round-trip them through the generic string-based TTSEngine API.
 */
function encodeVoiceId(modelId: number, speakerName: string, styleName: string): string {
  return `${modelId}:${speakerName}:${styleName}`;
}

function decodeVoiceId(id: string): { modelId: number; speakerName: string; styleName: string } {
  const [mid, spk, ...rest] = id.split(":");
  return {
    modelId: parseInt(mid, 10),
    speakerName: spk,
    styleName: rest.join(":"),
  };
}

interface SBV2ModelInfo {
  [modelName: string]: {
    model_path: string;
    config_path: string;
    spk2id: Record<string, number>;
    style2id: Record<string, number>;
    id: number;
  };
}

export const sbv2Engine: TTSEngine = {
  name: "Style-Bert-VITS2",
  type: "sbv2",

  async checkStatus(): Promise<boolean> {
    try {
      const r = await fetch(directUrl("/models/info"), { method: "GET" });
      if (!r.ok) return false;
      // Verify it's real SBV2 JSON (macOS AirPlay on port 5000 returns binary plist)
      const text = await r.text();
      JSON.parse(text);
      return true;
    } catch {
      return false;
    }
  },

  async getSpeakers(): Promise<TTSSpeaker[]> {
    const r = await fetch(directUrl("/models/info"), { method: "GET" });
    if (!r.ok) throw new Error(`Failed to get SBV2 models (${r.status})`);

    const models: SBV2ModelInfo = await r.json();
    const speakers: TTSSpeaker[] = [];

    for (const [modelName, info] of Object.entries(models)) {
      const speakerEntries = Object.entries(info.spk2id);
      const styleEntries = Object.entries(info.style2id);

      for (const [spkName] of speakerEntries) {
        const styles = styleEntries.map(([styleName]) => ({
          name: styleName,
          id: encodeVoiceId(info.id, spkName, styleName),
        }));

        speakers.push({
          name: speakerEntries.length > 1 ? `${modelName} - ${spkName}` : modelName,
          id: `${info.id}:${spkName}`,
          styles,
        });
      }
    }

    return speakers;
  },

  async synthesize(text: string, voiceId?: string): Promise<ArrayBuffer> {
    let modelId = 0;
    let speakerName = "";
    let styleName = "Neutral";

    if (voiceId) {
      const decoded = decodeVoiceId(voiceId);
      modelId = decoded.modelId;
      speakerName = decoded.speakerName;
      styleName = decoded.styleName;
    }

    const params = new URLSearchParams({
      text,
      model_id: String(modelId),
      language: "JP",
      style: styleName,
    });

    if (speakerName) {
      params.set("speaker_name", speakerName);
    }

    const r = await fetch(directUrl(`/voice?${params.toString()}`), { method: "GET" });
    if (!r.ok) {
      throw new Error(`SBV2 synthesis failed (${r.status})`);
    }

    return r.arrayBuffer();
  },
};
