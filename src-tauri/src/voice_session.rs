use std::io::Write;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Arc, Mutex,
};
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, SampleFormat, SampleRate, SizedSample};
use rubato::{FftFixedIn, Resampler};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::whisper::WhisperModelState;

const TARGET_SAMPLE_RATE: u32 = 16000;
const VAD_FRAME_MS: u32 = 32; // Silero v3 at 16kHz expects 512 samples = 32ms

const SPEECH_THRESHOLD: f32 = 0.5;
const SILENCE_THRESHOLD: f32 = 0.35;
const SPEECH_PAD_MS: u64 = 384;
const MIN_SPEECH_MS: u64 = 300;
/// End segment after this much clear silence (VAD prob < SILENCE_THRESHOLD)
const MAX_SILENCE_MS: u64 = 800;
/// Hard cutoff: end segment if no speech frame (prob > SPEECH_THRESHOLD) for this long,
/// even if ambient noise keeps the VAD in the "unknown" zone (0.35–0.6).
const MAX_NO_SPEECH_MS: u64 = 2000;
const MAX_SPEECH_S: u64 = 30;

/// Consecutive speech frames required before committing to speech onset
const ONSET_FRAMES: u32 = 3; // 3 × 30ms = 90ms of continuous speech
/// Minimum RMS energy to even bother running VAD (filters digital silence only)
const ENERGY_GATE: f32 = 0.0002;
/// Minimum fraction of speech frames in a segment to accept it for transcription
const MIN_SPEECH_RATIO: f32 = 0.15;

const RESAMPLER_CHUNK: usize = 1024;
const AMPLITUDE_INTERVAL_MS: u64 = 50;

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RecordingMode {
    #[default]
    Automatic,
    PushToTalk,
}

#[derive(Clone, Serialize)]
struct EmptyPayload {}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioSegmentPayload {
    audio_base64: String,
    sample_rate: u32,
}

#[derive(Clone, Serialize)]
struct AmplitudePayload {
    level: f32,
}

// ── Managed state ───────────────────────────────────────────────────────────

pub struct VoiceSessionState {
    handle: Mutex<Option<SessionHandle>>,
    paused: Arc<AtomicBool>,
    push_to_talk_active: Arc<AtomicBool>,
}

impl VoiceSessionState {
    pub fn new() -> Self {
        Self {
            handle: Mutex::new(None),
            paused: Arc::new(AtomicBool::new(false)),
            push_to_talk_active: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Stop any running voice session. Called on app exit.
    pub fn shutdown(&self) {
        self.push_to_talk_active.store(false, Ordering::SeqCst);
        if let Ok(mut lock) = self.handle.lock() {
            if let Some(mut handle) = lock.take() {
                handle.shutdown.store(true, Ordering::SeqCst);
                if let Some(w) = handle.worker.take() {
                    let _ = w.join();
                }
                log::info!("Voice session shut down on exit");
            }
        }
    }
}

struct SessionHandle {
    shutdown: Arc<AtomicBool>,
    worker: Option<std::thread::JoinHandle<()>>,
}

impl Drop for SessionHandle {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::SeqCst);
        if let Some(h) = self.worker.take() {
            let _ = h.join();
        }
    }
}

// ── Frame resampler ─────────────────────────────────────────────────────────

struct FrameResampler {
    resampler: Option<FftFixedIn<f32>>,
    chunk_in: usize,
    in_buf: Vec<f32>,
    frame_samples: usize,
    pending: Vec<f32>,
}

impl FrameResampler {
    fn new(in_hz: usize, out_hz: usize, frame_dur: Duration) -> Self {
        let frame_samples = ((out_hz as f64 * frame_dur.as_secs_f64()).round()) as usize;
        assert!(frame_samples > 0);

        let chunk_in = RESAMPLER_CHUNK;
        let resampler = (in_hz != out_hz).then(|| {
            FftFixedIn::<f32>::new(in_hz, out_hz, chunk_in, 1, 1)
                .expect("Failed to create resampler")
        });

        Self {
            resampler,
            chunk_in,
            in_buf: Vec::with_capacity(chunk_in),
            frame_samples,
            pending: Vec::with_capacity(frame_samples),
        }
    }

    fn push(&mut self, mut src: &[f32], mut emit: impl FnMut(&[f32])) {
        if self.resampler.is_none() {
            self.emit_frames(src, &mut emit);
            return;
        }

        while !src.is_empty() {
            let space = self.chunk_in - self.in_buf.len();
            let take = space.min(src.len());
            self.in_buf.extend_from_slice(&src[..take]);
            src = &src[take..];

            if self.in_buf.len() == self.chunk_in {
                if let Ok(out) = self
                    .resampler
                    .as_mut()
                    .unwrap()
                    .process(&[&self.in_buf[..]], None)
                {
                    self.emit_frames(&out[0], &mut emit);
                }
                self.in_buf.clear();
            }
        }
    }

    fn flush(&mut self, mut emit: impl FnMut(&[f32])) {
        if let Some(ref mut resampler) = self.resampler {
            if !self.in_buf.is_empty() {
                self.in_buf.resize(self.chunk_in, 0.0);
                if let Ok(out) = resampler.process(&[&self.in_buf[..]], None) {
                    self.emit_frames(&out[0], &mut emit);
                }
                self.in_buf.clear();
            }
        }
        if !self.pending.is_empty() {
            self.pending.resize(self.frame_samples, 0.0);
            emit(&self.pending);
            self.pending.clear();
        }
    }

    fn emit_frames(&mut self, mut data: &[f32], emit: &mut impl FnMut(&[f32])) {
        while !data.is_empty() {
            let space = self.frame_samples - self.pending.len();
            let take = space.min(data.len());
            self.pending.extend_from_slice(&data[..take]);
            data = &data[take..];

            if self.pending.len() == self.frame_samples {
                emit(&self.pending);
                self.pending.clear();
            }
        }
    }
}

fn diag_log(msg: &str) {
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/tama-voice.log")
    {
        let _ = writeln!(f, "{}", msg);
        let _ = f.flush();
    }
}

fn extend_pre_speech_ring(pre_speech_ring: &mut Vec<f32>, frame: &[f32], pad_frames: usize) {
    pre_speech_ring.extend_from_slice(frame);
    if pre_speech_ring.len() > pad_frames {
        let excess = pre_speech_ring.len() - pad_frames;
        pre_speech_ring.drain(..excess);
    }
}

fn build_typed_input_stream<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    channels: usize,
    tx: mpsc::Sender<Vec<f32>>,
) -> Result<cpal::Stream, cpal::BuildStreamError>
where
    T: SizedSample,
    f32: FromSample<T>,
{
    device.build_input_stream(
        config,
        move |data: &[T], _: &cpal::InputCallbackInfo| {
            let _ = tx.send(downmix_samples(data, channels));
        },
        |err| log::error!("Audio stream error: {}", err),
        None,
    )
}

fn downmix_samples<T>(data: &[T], channels: usize) -> Vec<f32>
where
    T: SizedSample,
    f32: FromSample<T>,
{
    if channels == 1 {
        return data
            .iter()
            .map(|sample| sample.to_sample::<f32>())
            .collect();
    }

    data.chunks_exact(channels)
        .map(|frame| {
            frame
                .iter()
                .map(|sample| sample.to_sample::<f32>())
                .sum::<f32>()
                / channels as f32
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{downmix_samples, segment_has_enough_speech, RecordingMode};

    #[test]
    fn converts_i16_mono_to_f32() {
        let converted = downmix_samples(&[i16::MIN, 0, i16::MAX], 1);
        assert_eq!(converted.len(), 3);
        assert!((converted[0] + 1.0).abs() < 0.0001);
        assert_eq!(converted[1], 0.0);
        assert!((converted[2] - 1.0).abs() < 0.0001);
    }

    #[test]
    fn downmixes_stereo_samples() {
        let converted = downmix_samples(&[1.0_f32, -1.0, 0.5, 0.5], 2);
        assert_eq!(converted, vec![0.0, 0.5]);
    }

    #[test]
    fn automatic_segments_require_a_minimum_speech_ratio() {
        assert!(!segment_has_enough_speech(
            RecordingMode::Automatic,
            10,
            100
        ));
        assert!(segment_has_enough_speech(RecordingMode::Automatic, 15, 100));
    }

    #[test]
    fn push_to_talk_allows_pauses_but_rejects_silent_press() {
        assert!(segment_has_enough_speech(RecordingMode::PushToTalk, 3, 100));
        assert!(!segment_has_enough_speech(
            RecordingMode::PushToTalk,
            2,
            100
        ));
    }
}

// ── Worker: owns the cpal stream + runs VAD pipeline ────────────────────────

fn run_worker(
    app: AppHandle,
    shutdown: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
    push_to_talk_active: Arc<AtomicBool>,
    recording_mode: RecordingMode,
    vad_model_path: String,
    ready_tx: mpsc::SyncSender<Result<(), String>>,
) {
    // -- Open microphone (all on this thread so Stream doesn't cross threads) --
    let host = cpal::default_host();
    let device = match host.default_input_device() {
        Some(d) => d,
        None => {
            let _ = ready_tx.send(Err("No input audio device found".into()));
            return;
        }
    };

    let supported_config = match get_preferred_config(&device) {
        Ok(c) => c,
        Err(e) => {
            let _ = ready_tx.send(Err(e));
            return;
        }
    };

    let sample_rate = supported_config.sample_rate().0;
    let channels = supported_config.channels() as usize;
    let sample_format = supported_config.sample_format();

    let dev_info = format!(
        "Audio device: {:?}, rate: {}, channels: {}, format: {:?}",
        device.name().unwrap_or_default(),
        sample_rate,
        channels,
        supported_config.sample_format()
    );
    log::info!("{}", dev_info);
    diag_log(&dev_info);

    let (tx, rx) = mpsc::channel::<Vec<f32>>();
    let config: cpal::StreamConfig = supported_config.into();

    let stream_result = match sample_format {
        SampleFormat::I8 => build_typed_input_stream::<i8>(&device, &config, channels, tx),
        SampleFormat::I16 => build_typed_input_stream::<i16>(&device, &config, channels, tx),
        SampleFormat::I32 => build_typed_input_stream::<i32>(&device, &config, channels, tx),
        SampleFormat::I64 => build_typed_input_stream::<i64>(&device, &config, channels, tx),
        SampleFormat::U8 => build_typed_input_stream::<u8>(&device, &config, channels, tx),
        SampleFormat::U16 => build_typed_input_stream::<u16>(&device, &config, channels, tx),
        SampleFormat::U32 => build_typed_input_stream::<u32>(&device, &config, channels, tx),
        SampleFormat::U64 => build_typed_input_stream::<u64>(&device, &config, channels, tx),
        SampleFormat::F32 => build_typed_input_stream::<f32>(&device, &config, channels, tx),
        SampleFormat::F64 => build_typed_input_stream::<f64>(&device, &config, channels, tx),
        _ => {
            let _ = ready_tx.send(Err(format!(
                "Unsupported microphone sample format: {sample_format}"
            )));
            return;
        }
    };

    let stream = match stream_result {
        Ok(s) => s,
        Err(e) => {
            let _ = ready_tx.send(Err(format!("Failed to build input stream: {e}")));
            return;
        }
    };

    if let Err(e) = stream.play() {
        let _ = ready_tx.send(Err(format!("Failed to start audio stream: {e}")));
        return;
    }

    // -- Initialize VAD --
    diag_log(&format!("Loading VAD model from: {}", vad_model_path));
    let mut vad = match vad_rs::Vad::new(&vad_model_path, TARGET_SAMPLE_RATE as usize) {
        Ok(v) => {
            diag_log("VAD initialized successfully");
            v
        }
        Err(e) => {
            diag_log(&format!("VAD init failed: {e}"));
            let _ = ready_tx.send(Err(format!("VAD init failed: {e}")));
            return;
        }
    };

    // Signal success to the calling command
    let _ = ready_tx.send(Ok(()));
    diag_log("Worker ready, entering processing loop");

    // -- Processing loop --
    let mut resampler = FrameResampler::new(
        sample_rate as usize,
        TARGET_SAMPLE_RATE as usize,
        Duration::from_millis(VAD_FRAME_MS as u64),
    );

    let mut speech_buf: Vec<f32> = Vec::new();
    let mut is_speech = false;
    let mut speech_start: Option<Instant> = None;
    let mut last_speech_time: Option<Instant> = None;
    let mut last_amplitude_emit = Instant::now();
    let session_start = Instant::now();
    let mut last_diag_log = Instant::now();

    // Onset confirmation: count consecutive speech frames before committing
    let mut consecutive_speech: u32 = 0;

    // Track how many VAD frames were classified as speech within the current segment
    let mut speech_frame_count: u32 = 0;
    let mut total_frame_count: u32 = 0;

    let pad_frames = (SPEECH_PAD_MS as usize * TARGET_SAMPLE_RATE as usize) / 1000;
    let mut pre_speech_ring: Vec<f32> = Vec::with_capacity(pad_frames);

    while !shutdown.load(Ordering::Relaxed) {
        let raw = match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(s) => s,
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        };

        // While paused (AI is speaking via TTS), discard all audio and reset VAD
        // state so the AI's voice is never captured or transcribed.
        if paused.load(Ordering::Relaxed) {
            push_to_talk_active.store(false, Ordering::Relaxed);
            if is_speech {
                is_speech = false;
                speech_buf.clear();
                pre_speech_ring.clear();
                consecutive_speech = 0;
                speech_frame_count = 0;
                total_frame_count = 0;
                vad.reset();
            }
            continue;
        }

        let rms = (raw.iter().map(|s| s * s).sum::<f32>() / raw.len().max(1) as f32).sqrt();

        // Log audio levels periodically for diagnostics (every 2s for first 10s, then every 10s)
        let diag_interval = if session_start.elapsed().as_secs() < 10 {
            2000
        } else {
            10000
        };
        if last_diag_log.elapsed().as_millis() as u64 >= diag_interval {
            let peak = raw.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
            let msg = format!(
                "Audio diag: rms={:.6}, peak={:.6}, samples={}, is_speech={}",
                rms,
                peak,
                raw.len(),
                is_speech
            );
            log::info!("{}", msg);
            diag_log(&msg);
            last_diag_log = Instant::now();
        }

        if last_amplitude_emit.elapsed() >= Duration::from_millis(AMPLITUDE_INTERVAL_MS) {
            let should_emit_level = recording_mode == RecordingMode::Automatic
                || push_to_talk_active.load(Ordering::Relaxed);
            let _ = app.emit(
                "voice-amplitude",
                AmplitudePayload {
                    level: if should_emit_level { rms } else { 0.0 },
                },
            );
            last_amplitude_emit = Instant::now();
        }

        if recording_mode == RecordingMode::PushToTalk {
            if push_to_talk_active.load(Ordering::Relaxed) {
                if !is_speech {
                    diag_log("Push-to-talk recording started");
                    is_speech = true;
                    speech_start = Some(Instant::now());
                    last_speech_time = None;
                    speech_frame_count = 0;
                    total_frame_count = 0;
                    speech_buf.clear();
                    pre_speech_ring.clear();
                    vad.reset();
                    let _ = app.emit("voice-speech-start", EmptyPayload {});
                }

                resampler.push(&raw, |frame: &[f32]| {
                    speech_buf.extend_from_slice(frame);
                    total_frame_count += 1;

                    let frame_rms = (frame.iter().map(|sample| sample * sample).sum::<f32>()
                        / frame.len() as f32)
                        .sqrt();
                    if frame_rms >= ENERGY_GATE {
                        match vad.compute(frame) {
                            Ok(result) if result.prob > SPEECH_THRESHOLD => {
                                speech_frame_count += 1;
                            }
                            Ok(_) => {}
                            Err(err) => diag_log(&format!("VAD compute error: {err:?}")),
                        }
                    }
                });
            } else if is_speech {
                resampler.flush(|frame: &[f32]| {
                    speech_buf.extend_from_slice(frame);
                });
                finalize_speech(
                    &app,
                    &mut is_speech,
                    &mut speech_buf,
                    &mut speech_start,
                    &mut vad,
                    &mut pre_speech_ring,
                    speech_frame_count,
                    total_frame_count,
                    recording_mode,
                );
                speech_frame_count = 0;
                total_frame_count = 0;
            }

            continue;
        }

        resampler.push(&raw, |frame: &[f32]| {
            if !is_speech {
                // Keep a rolling pre-roll buffer even while onset is being confirmed so
                // the first speech frames are preserved when a segment starts.
                extend_pre_speech_ring(&mut pre_speech_ring, frame, pad_frames);
            }

            // Energy gate: skip frames that are practically silent
            let rms = (frame.iter().map(|s| s * s).sum::<f32>() / frame.len() as f32).sqrt();
            if rms < ENERGY_GATE {
                // Dead silence -- treat as definite silence
                consecutive_speech = 0;
                if is_speech {
                    // Still accumulate for the trailing buffer
                    speech_buf.extend_from_slice(frame);
                    total_frame_count += 1;

                    let silence_dur = last_speech_time
                        .map(|t| t.elapsed().as_millis() as u64)
                        .unwrap_or(0);
                    if silence_dur > MAX_SILENCE_MS {
                        finalize_speech(
                            &app,
                            &mut is_speech,
                            &mut speech_buf,
                            &mut speech_start,
                            &mut vad,
                            &mut pre_speech_ring,
                            speech_frame_count,
                            total_frame_count,
                            recording_mode,
                        );
                        speech_frame_count = 0;
                        total_frame_count = 0;
                    }
                }
                return;
            }

            let result = match vad.compute(frame) {
                Ok(r) => r,
                Err(e) => {
                    diag_log(&format!("VAD compute error: {e:?}"));
                    return;
                }
            };

            let prob = result.prob;
            let frame_is_speech = prob > SPEECH_THRESHOLD;
            let frame_is_silence = prob < SILENCE_THRESHOLD;

            if frame_is_speech {
                consecutive_speech += 1;

                if !is_speech && consecutive_speech >= ONSET_FRAMES {
                    diag_log("Speech onset");
                    is_speech = true;
                    speech_start = Some(Instant::now());
                    last_speech_time = Some(Instant::now());
                    speech_frame_count = 0;
                    total_frame_count = 0;
                    let _ = app.emit("voice-speech-start", EmptyPayload {});
                    speech_buf.clear();
                    speech_buf.extend_from_slice(&pre_speech_ring);
                }

                if is_speech {
                    last_speech_time = Some(Instant::now());
                    speech_buf.extend_from_slice(frame);
                    speech_frame_count += 1;
                    total_frame_count += 1;
                }
            } else {
                consecutive_speech = 0;

                if is_speech {
                    speech_buf.extend_from_slice(frame);
                    total_frame_count += 1;

                    let no_speech_dur = last_speech_time
                        .map(|t| t.elapsed().as_millis() as u64)
                        .unwrap_or(0);
                    let speech_dur = speech_start
                        .map(|t| t.elapsed().as_millis() as u64)
                        .unwrap_or(0);

                    // End on clear silence (fast path)
                    // OR on prolonged absence of speech frames even with ambient noise
                    // OR on max speech duration
                    let should_end = (frame_is_silence && no_speech_dur > MAX_SILENCE_MS)
                        || no_speech_dur > MAX_NO_SPEECH_MS
                        || speech_dur > MAX_SPEECH_S * 1000;

                    if should_end {
                        finalize_speech(
                            &app,
                            &mut is_speech,
                            &mut speech_buf,
                            &mut speech_start,
                            &mut vad,
                            &mut pre_speech_ring,
                            speech_frame_count,
                            total_frame_count,
                            recording_mode,
                        );
                        speech_frame_count = 0;
                        total_frame_count = 0;
                    }
                } else {
                    // Pre-roll is already tracked at the top of the frame handler.
                }
            }
        });
    }

    // Flush remaining speech on shutdown
    if is_speech && !speech_buf.is_empty() {
        resampler.flush(|frame: &[f32]| {
            speech_buf.extend_from_slice(frame);
        });
        finalize_speech(
            &app,
            &mut is_speech,
            &mut speech_buf,
            &mut speech_start,
            &mut vad,
            &mut pre_speech_ring,
            speech_frame_count,
            total_frame_count,
            recording_mode,
        );
    }

    // Stream is dropped here, ending capture
    drop(stream);
    log::info!("Voice session worker stopped");
}

/// End the current speech segment: check speech ratio, emit events, and
/// forward the PCM audio to the webview for transcription.
#[allow(clippy::too_many_arguments)]
fn finalize_speech(
    app: &AppHandle,
    is_speech: &mut bool,
    speech_buf: &mut Vec<f32>,
    speech_start: &mut Option<Instant>,
    vad: &mut vad_rs::Vad,
    pre_speech_ring: &mut Vec<f32>,
    speech_frame_count: u32,
    total_frame_count: u32,
    recording_mode: RecordingMode,
) {
    *is_speech = false;

    let speech_dur = speech_start
        .map(|t| t.elapsed().as_millis() as u64)
        .unwrap_or(0);

    let speech_ratio = if total_frame_count > 0 {
        speech_frame_count as f32 / total_frame_count as f32
    } else {
        0.0
    };

    let seg_msg = format!(
        "Speech segment: {:.0}ms, {}/{} frames speech ({:.0}%)",
        speech_dur,
        speech_frame_count,
        total_frame_count,
        speech_ratio * 100.0,
    );
    log::info!("{}", seg_msg);
    diag_log(&seg_msg);

    let has_enough_speech =
        segment_has_enough_speech(recording_mode, speech_frame_count, total_frame_count);

    if speech_dur >= MIN_SPEECH_MS && !speech_buf.is_empty() && has_enough_speech {
        let _ = app.emit("voice-speech-end", EmptyPayload {});
        let audio = std::mem::take(speech_buf);
        let app2 = app.clone();
        std::thread::spawn(move || {
            emit_audio_segment(app2, audio);
        });
    } else {
        let _ = app.emit("voice-speech-cancelled", EmptyPayload {});
        if !has_enough_speech && total_frame_count > 0 {
            log::info!(
                "Discarding segment: insufficient speech ({:.0}% speech frames)",
                speech_ratio * 100.0,
            );
        }
        speech_buf.clear();
    }

    vad.reset();
    pre_speech_ring.clear();
    *speech_start = None;
}

fn segment_has_enough_speech(
    recording_mode: RecordingMode,
    speech_frame_count: u32,
    total_frame_count: u32,
) -> bool {
    match recording_mode {
        RecordingMode::Automatic => {
            total_frame_count > 0
                && speech_frame_count as f32 / total_frame_count as f32 >= MIN_SPEECH_RATIO
        }
        RecordingMode::PushToTalk => speech_frame_count >= ONSET_FRAMES,
    }
}

fn emit_audio_segment(app: AppHandle, audio: Vec<f32>) {
    use base64::Engine;

    let tx_msg = format!(
        "Emitting audio segment with {} samples ({:.1}s)",
        audio.len(),
        audio.len() as f64 / TARGET_SAMPLE_RATE as f64
    );
    log::info!("{}", tx_msg);
    diag_log(&tx_msg);

    let mut raw_bytes = Vec::with_capacity(audio.len() * std::mem::size_of::<f32>());
    for sample in audio {
        raw_bytes.extend_from_slice(&sample.to_le_bytes());
    }

    let audio_base64 = base64::engine::general_purpose::STANDARD.encode(raw_bytes);
    let _ = app.emit(
        "voice-audio-segment",
        AudioSegmentPayload {
            audio_base64,
            sample_rate: TARGET_SAMPLE_RATE,
        },
    );
}

// ── Tauri commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn start_voice_session(
    app: AppHandle,
    voice_state: State<'_, VoiceSessionState>,
    require_whisper_loaded: Option<bool>,
    recording_mode: Option<RecordingMode>,
    whisper_state: State<'_, WhisperModelState>,
) -> Result<(), String> {
    {
        let lock = voice_state.handle.lock().map_err(|e| e.to_string())?;
        if lock.is_some() {
            return Err("Voice session already running".into());
        }
    }

    let require_whisper_loaded = require_whisper_loaded.unwrap_or(true);
    let recording_mode = recording_mode.unwrap_or_default();
    if require_whisper_loaded {
        let whisper_loaded = {
            let lock = whisper_state.context.lock().map_err(|e| e.to_string())?;
            lock.is_some()
        };
        if !whisper_loaded {
            return Err("Whisper model not loaded. Load it first from Settings.".into());
        }
    }

    let vad_model_path = app
        .path()
        .resolve(
            "resources/silero_vad.onnx",
            tauri::path::BaseDirectory::Resource,
        )
        .map_err(|e| format!("Failed to resolve VAD model path: {e}"))?;

    if !vad_model_path.exists() {
        return Err(format!(
            "Silero VAD model not found at {}",
            vad_model_path.display()
        ));
    }

    let vad_path_str = vad_model_path
        .to_str()
        .ok_or("Invalid VAD model path")?
        .to_string();

    let shutdown = Arc::new(AtomicBool::new(false));
    let (ready_tx, ready_rx) = mpsc::sync_channel::<Result<(), String>>(1);

    // Reset paused state on session start
    voice_state.paused.store(false, Ordering::SeqCst);
    voice_state
        .push_to_talk_active
        .store(false, Ordering::SeqCst);

    let worker_shutdown = shutdown.clone();
    let worker_paused = voice_state.paused.clone();
    let worker_push_to_talk_active = voice_state.push_to_talk_active.clone();
    let worker_app = app.clone();
    let worker = std::thread::spawn(move || {
        run_worker(
            worker_app,
            worker_shutdown,
            worker_paused,
            worker_push_to_talk_active,
            recording_mode,
            vad_path_str,
            ready_tx,
        );
    });

    // Wait for the worker to signal success or failure
    let result = ready_rx
        .recv_timeout(Duration::from_secs(10))
        .map_err(|_| "Timeout waiting for audio device initialization".to_string())?;

    result?;

    let mut lock = voice_state.handle.lock().map_err(|e| e.to_string())?;
    *lock = Some(SessionHandle {
        shutdown,
        worker: Some(worker),
    });

    log::info!("Voice session started");
    Ok(())
}

#[tauri::command]
pub async fn stop_voice_session(voice_state: State<'_, VoiceSessionState>) -> Result<(), String> {
    voice_state.paused.store(false, Ordering::SeqCst);
    voice_state
        .push_to_talk_active
        .store(false, Ordering::SeqCst);
    let mut lock = voice_state.handle.lock().map_err(|e| e.to_string())?;
    if let Some(mut handle) = lock.take() {
        handle.shutdown.store(true, Ordering::SeqCst);
        if let Some(w) = handle.worker.take() {
            let _ = w.join();
        }
        log::info!("Voice session stopped");
    }
    Ok(())
}

#[tauri::command]
pub async fn pause_voice_session(voice_state: State<'_, VoiceSessionState>) -> Result<(), String> {
    voice_state.paused.store(true, Ordering::SeqCst);
    voice_state
        .push_to_talk_active
        .store(false, Ordering::SeqCst);
    log::info!("Voice session paused");
    Ok(())
}

#[tauri::command]
pub async fn resume_voice_session(voice_state: State<'_, VoiceSessionState>) -> Result<(), String> {
    voice_state.paused.store(false, Ordering::SeqCst);
    log::info!("Voice session resumed");
    Ok(())
}

#[tauri::command]
pub async fn begin_push_to_talk(voice_state: State<'_, VoiceSessionState>) -> Result<(), String> {
    let is_running = voice_state
        .handle
        .lock()
        .map_err(|error| error.to_string())?
        .is_some();
    if !is_running {
        return Err("Voice session is not running".into());
    }

    if voice_state.paused.load(Ordering::SeqCst) {
        return Err("Voice session is paused".into());
    }

    voice_state
        .push_to_talk_active
        .store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub async fn end_push_to_talk(voice_state: State<'_, VoiceSessionState>) -> Result<(), String> {
    voice_state
        .push_to_talk_active
        .store(false, Ordering::SeqCst);
    Ok(())
}

// ── Audio helpers ───────────────────────────────────────────────────────────

fn get_preferred_config(device: &cpal::Device) -> Result<cpal::SupportedStreamConfig, String> {
    let supported_configs = device
        .supported_input_configs()
        .map_err(|e| format!("Failed to get supported configs: {e}"))?;

    let mut best_config: Option<cpal::SupportedStreamConfigRange> = None;

    for config_range in supported_configs {
        if config_range.min_sample_rate().0 <= TARGET_SAMPLE_RATE
            && config_range.max_sample_rate().0 >= TARGET_SAMPLE_RATE
        {
            match best_config {
                None => best_config = Some(config_range),
                Some(ref current) => {
                    let score = |fmt: SampleFormat| match fmt {
                        SampleFormat::F32 => 4,
                        SampleFormat::I16 => 3,
                        SampleFormat::I32 => 2,
                        _ => 1,
                    };
                    if score(config_range.sample_format()) > score(current.sample_format()) {
                        best_config = Some(config_range);
                    }
                }
            }
        }
    }

    if let Some(config) = best_config {
        return Ok(config.with_sample_rate(SampleRate(TARGET_SAMPLE_RATE)));
    }

    device
        .default_input_config()
        .map_err(|e| format!("Failed to get default input config: {e}"))
}
