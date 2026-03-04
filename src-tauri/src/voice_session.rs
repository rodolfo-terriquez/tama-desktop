use std::io::Write;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Arc, Mutex,
};
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, SampleRate};
use rubato::{FftFixedIn, Resampler};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use whisper_rs::{FullParams, SamplingStrategy};

use crate::whisper::WhisperModelState;

const TARGET_SAMPLE_RATE: u32 = 16000;
const VAD_FRAME_MS: u32 = 32; // Silero v3 at 16kHz expects 512 samples = 32ms

const SPEECH_THRESHOLD: f32 = 0.5;
const SILENCE_THRESHOLD: f32 = 0.35;
const SPEECH_PAD_MS: u64 = 200;
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
const ENERGY_GATE: f32 = 0.001;
/// Minimum fraction of speech frames in a segment to accept it for transcription
const MIN_SPEECH_RATIO: f32 = 0.15;

const RESAMPLER_CHUNK: usize = 1024;
const AMPLITUDE_INTERVAL_MS: u64 = 50;

#[derive(Clone, Serialize)]
struct EmptyPayload {}

#[derive(Clone, Serialize)]
struct TranscriptionPayload {
    text: String,
}

#[derive(Clone, Serialize)]
struct AmplitudePayload {
    level: f32,
}

#[derive(Clone, Serialize)]
struct ErrorPayload {
    message: String,
}

// ── Managed state ───────────────────────────────────────────────────────────

pub struct VoiceSessionState {
    handle: Mutex<Option<SessionHandle>>,
    paused: Arc<AtomicBool>,
}

impl VoiceSessionState {
    pub fn new() -> Self {
        Self {
            handle: Mutex::new(None),
            paused: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Stop any running voice session. Called on app exit.
    pub fn shutdown(&self) {
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

// ── Worker: owns the cpal stream + runs VAD + whisper pipeline ──────────────

fn run_worker(
    app: AppHandle,
    whisper_ctx: Arc<whisper_rs::WhisperContext>,
    shutdown: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
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

    let stream = match device.build_input_stream(
        &config,
        move |data: &[f32], _: &cpal::InputCallbackInfo| {
            let mono: Vec<f32> = if channels == 1 {
                data.to_vec()
            } else {
                data.chunks_exact(channels)
                    .map(|frame| frame.iter().sum::<f32>() / channels as f32)
                    .collect()
            };
            let _ = tx.send(mono);
        },
        |err| log::error!("Audio stream error: {}", err),
        None,
    ) {
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
        let diag_interval = if session_start.elapsed().as_secs() < 10 { 2000 } else { 10000 };
        if last_diag_log.elapsed().as_millis() as u64 >= diag_interval {
            let peak = raw.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
            let msg = format!(
                "Audio diag: rms={:.6}, peak={:.6}, samples={}, is_speech={}",
                rms, peak, raw.len(), is_speech
            );
            log::info!("{}", msg);
            diag_log(&msg);
            last_diag_log = Instant::now();
        }

        if last_amplitude_emit.elapsed() >= Duration::from_millis(AMPLITUDE_INTERVAL_MS) {
            let _ = app.emit("voice-amplitude", AmplitudePayload { level: rms });
            last_amplitude_emit = Instant::now();
        }

        resampler.push(&raw, |frame: &[f32]| {
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
                            &app, &whisper_ctx, &mut is_speech, &mut speech_buf,
                            &mut speech_start, &mut vad, &mut pre_speech_ring,
                            speech_frame_count, total_frame_count,
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
                            &app, &whisper_ctx, &mut is_speech, &mut speech_buf,
                            &mut speech_start, &mut vad, &mut pre_speech_ring,
                            speech_frame_count, total_frame_count,
                        );
                        speech_frame_count = 0;
                        total_frame_count = 0;
                    }
                } else {
                    pre_speech_ring.extend_from_slice(frame);
                    if pre_speech_ring.len() > pad_frames {
                        let excess = pre_speech_ring.len() - pad_frames;
                        pre_speech_ring.drain(..excess);
                    }
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
            &app, &whisper_ctx, &mut is_speech, &mut speech_buf,
            &mut speech_start, &mut vad, &mut pre_speech_ring,
            speech_frame_count, total_frame_count,
        );
    }

    // Stream is dropped here, ending capture
    drop(stream);
    log::info!("Voice session worker stopped");
}

/// End the current speech segment: check speech ratio, emit events, and optionally transcribe.
#[allow(clippy::too_many_arguments)]
fn finalize_speech(
    app: &AppHandle,
    whisper_ctx: &Arc<whisper_rs::WhisperContext>,
    is_speech: &mut bool,
    speech_buf: &mut Vec<f32>,
    speech_start: &mut Option<Instant>,
    vad: &mut vad_rs::Vad,
    pre_speech_ring: &mut Vec<f32>,
    speech_frame_count: u32,
    total_frame_count: u32,
) {
    *is_speech = false;
    let _ = app.emit("voice-speech-end", EmptyPayload {});

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
        speech_dur, speech_frame_count, total_frame_count, speech_ratio * 100.0,
    );
    log::info!("{}", seg_msg);
    diag_log(&seg_msg);

    if speech_dur >= MIN_SPEECH_MS
        && !speech_buf.is_empty()
        && speech_ratio >= MIN_SPEECH_RATIO
    {
        let audio = std::mem::take(speech_buf);
        let ctx = whisper_ctx.clone();
        let app2 = app.clone();
        std::thread::spawn(move || {
            transcribe_and_emit(app2, ctx, audio);
        });
    } else {
        if speech_ratio < MIN_SPEECH_RATIO && total_frame_count > 0 {
            log::info!(
                "Discarding segment: speech ratio {:.0}% below threshold {:.0}%",
                speech_ratio * 100.0,
                MIN_SPEECH_RATIO * 100.0
            );
        }
        speech_buf.clear();
    }

    vad.reset();
    pre_speech_ring.clear();
    *speech_start = None;
}

fn transcribe_and_emit(
    app: AppHandle,
    ctx: Arc<whisper_rs::WhisperContext>,
    audio: Vec<f32>,
) {
    let tx_msg = format!(
        "Transcribing {} samples ({:.1}s)",
        audio.len(),
        audio.len() as f64 / TARGET_SAMPLE_RATE as f64
    );
    log::info!("{}", tx_msg);
    diag_log(&tx_msg);

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(Some("ja"));
    params.set_n_threads(4);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_no_timestamps(true);
    params.set_suppress_blank(true);
    params.set_suppress_nst(true);
    params.set_temperature(0.0);
    params.set_single_segment(false);

    let mut state = match ctx.create_state() {
        Ok(s) => s,
        Err(e) => {
            let _ = app.emit(
                "voice-error",
                ErrorPayload {
                    message: format!("Whisper state error: {e}"),
                },
            );
            return;
        }
    };

    if let Err(e) = state.full(params, &audio) {
        let _ = app.emit(
            "voice-error",
            ErrorPayload {
                message: format!("Transcription failed: {e}"),
            },
        );
        return;
    }

    let mut text = String::new();
    for segment in state.as_iter() {
        text.push_str(&segment.to_string());
    }
    let text = text.trim().to_string();

    if !text.is_empty() {
        log::info!("Voice transcription: {}", text);
        diag_log(&format!("Transcription result: {}", text));
        let _ = app.emit("voice-transcription", TranscriptionPayload { text });
    } else {
        log::info!("Voice transcription returned empty, ignoring");
        diag_log("Transcription returned empty");
    }
}

// ── Tauri commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn start_voice_session(
    app: AppHandle,
    voice_state: State<'_, VoiceSessionState>,
    whisper_state: State<'_, WhisperModelState>,
) -> Result<(), String> {
    {
        let lock = voice_state.handle.lock().map_err(|e| e.to_string())?;
        if lock.is_some() {
            return Err("Voice session already running".into());
        }
    }

    let whisper_ctx = {
        let lock = whisper_state.context.lock().map_err(|e| e.to_string())?;
        lock.clone()
    };
    let whisper_ctx = whisper_ctx.ok_or("Whisper model not loaded. Load it first from Settings.")?;

    let vad_model_path = app
        .path()
        .resolve("resources/silero_vad.onnx", tauri::path::BaseDirectory::Resource)
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

    let worker_shutdown = shutdown.clone();
    let worker_paused = voice_state.paused.clone();
    let worker_app = app.clone();
    let worker_ctx = whisper_ctx.clone();
    let worker = std::thread::spawn(move || {
        run_worker(worker_app, worker_ctx, worker_shutdown, worker_paused, vad_path_str, ready_tx);
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
pub async fn stop_voice_session(
    voice_state: State<'_, VoiceSessionState>,
) -> Result<(), String> {
    voice_state.paused.store(false, Ordering::SeqCst);
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
pub async fn pause_voice_session(
    voice_state: State<'_, VoiceSessionState>,
) -> Result<(), String> {
    voice_state.paused.store(true, Ordering::SeqCst);
    log::info!("Voice session paused");
    Ok(())
}

#[tauri::command]
pub async fn resume_voice_session(
    voice_state: State<'_, VoiceSessionState>,
) -> Result<(), String> {
    voice_state.paused.store(false, Ordering::SeqCst);
    log::info!("Voice session resumed");
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
