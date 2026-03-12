/**
 * Returns the best MediaRecorder mimeType for the current environment.
 * WKWebView (Tauri/Safari) supports audio/mp4 but NOT audio/webm.
 */
export function getSupportedMimeType(): string {
  const types = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const t of types) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) {
      return t;
    }
  }
  return "";
}

export function float32PCMToWavBlob(
  pcm: Float32Array,
  sampleRate = 16000
): Blob {
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataLength = pcm.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < pcm.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, pcm[i]));
    const int16 =
      sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
    view.setInt16(offset, int16, true);
    offset += bytesPerSample;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

export function base64ToFloat32PCM(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  const sampleCount = Math.floor(bytes.byteLength / 4);
  const pcm = new Float32Array(sampleCount);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  for (let i = 0; i < sampleCount; i += 1) {
    pcm[i] = view.getFloat32(i * 4, true);
  }

  return pcm;
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

/**
 * Convert an audio Blob (WebM, MP4, WAV, etc.) to 16 kHz mono Float32 PCM
 * suitable for whisper-rs inference.
 */
export async function blobToFloat32PCM(
  blob: Blob,
  targetSampleRate = 16000
): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer();

  // Decode the compressed audio into an AudioBuffer at the target sample rate.
  // OfflineAudioContext handles resampling automatically.
  const offlineCtx = new OfflineAudioContext(1, 1, targetSampleRate);
  const decoded = await offlineCtx.decodeAudioData(arrayBuffer);

  // Render the decoded audio at the target sample rate (mono).
  const frames = Math.ceil(decoded.duration * targetSampleRate);
  const renderCtx = new OfflineAudioContext(1, frames, targetSampleRate);
  const source = renderCtx.createBufferSource();
  source.buffer = decoded;
  source.connect(renderCtx.destination);
  source.start();

  const rendered = await renderCtx.startRendering();
  return rendered.getChannelData(0);
}
