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
