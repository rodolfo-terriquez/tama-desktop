use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

const MODEL_URL: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin";
const MODEL_FILENAME: &str = "ggml-small.bin";

pub struct WhisperModelState {
    pub context: Mutex<Option<Arc<WhisperContext>>>,
    pub is_downloading: AtomicBool,
}

impl WhisperModelState {
    pub fn new() -> Self {
        Self {
            context: Mutex::new(None),
            is_downloading: AtomicBool::new(false),
        }
    }
}

#[derive(Clone, Serialize)]
pub struct ModelStatus {
    pub loaded: bool,
    pub model_exists: bool,
    pub model_path: String,
    pub model_size_bytes: u64,
    pub is_downloading: bool,
}

#[derive(Clone, Serialize)]
struct DownloadProgress {
    downloaded: u64,
    total: u64,
    percent: u32,
}

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    Ok(data_dir.join("models"))
}

fn model_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(models_dir(app)?.join(MODEL_FILENAME))
}

/// Automatically load the Whisper model at startup if it's already been downloaded.
pub async fn auto_load_if_downloaded(app: &AppHandle, state: &WhisperModelState) {
    {
        let lock = state.context.lock().unwrap_or_else(|e| e.into_inner());
        if lock.is_some() {
            return;
        }
    }

    let path = match model_path(app) {
        Ok(p) => p,
        Err(_) => return,
    };

    if !path.exists() {
        log::info!("Whisper model not downloaded yet, skipping auto-load");
        return;
    }

    log::info!("Auto-loading Whisper model from {}", path.display());

    let path_clone = path.clone();
    let ctx = match tokio::task::spawn_blocking(move || {
        let params = WhisperContextParameters::default();
        WhisperContext::new_with_params(path_clone.to_str().unwrap_or_default(), params)
    })
    .await
    {
        Ok(Ok(ctx)) => ctx,
        Ok(Err(e)) => {
            log::warn!("Failed to auto-load Whisper model: {e}");
            return;
        }
        Err(e) => {
            log::warn!("Whisper auto-load task failed: {e}");
            return;
        }
    };

    let mut lock = state.context.lock().unwrap_or_else(|e| e.into_inner());
    *lock = Some(Arc::new(ctx));
    log::info!("Whisper model auto-loaded successfully");
}

#[tauri::command]
pub async fn get_whisper_model_status(
    app: AppHandle,
    state: State<'_, WhisperModelState>,
) -> Result<ModelStatus, String> {
    let path = model_path(&app)?;
    let exists = path.exists();
    let size = if exists {
        std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0)
    } else {
        0
    };
    let loaded = state.context.lock().map_err(|e| e.to_string())?.is_some();

    Ok(ModelStatus {
        loaded,
        model_exists: exists,
        model_path: path.to_string_lossy().to_string(),
        model_size_bytes: size,
        is_downloading: state.is_downloading.load(Ordering::Relaxed),
    })
}

#[tauri::command]
pub async fn load_whisper_model(
    app: AppHandle,
    state: State<'_, WhisperModelState>,
) -> Result<(), String> {
    {
        let lock = state.context.lock().map_err(|e| e.to_string())?;
        if lock.is_some() {
            log::info!("Whisper model already loaded");
            return Ok(());
        }
    }

    let path = model_path(&app)?;

    if !path.exists() {
        download_model(&app, &state).await?;
    }

    let path_clone = path.clone();
    let ctx = tokio::task::spawn_blocking(move || {
        log::info!("Loading whisper model from {}", path_clone.display());
        let params = WhisperContextParameters::default();
        WhisperContext::new_with_params(path_clone.to_str().unwrap_or_default(), params)
            .map_err(|e| format!("Failed to load model: {e}"))
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))??;

    let mut lock = state.context.lock().map_err(|e| e.to_string())?;
    *lock = Some(Arc::new(ctx));
    log::info!("Whisper model loaded successfully");

    Ok(())
}

async fn download_model(app: &AppHandle, state: &WhisperModelState) -> Result<(), String> {
    if state
        .is_downloading
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::Relaxed)
        .is_err()
    {
        return Err("Download already in progress".to_string());
    }

    let result = download_model_inner(app).await;
    state.is_downloading.store(false, Ordering::Relaxed);
    result
}

async fn download_model_inner(app: &AppHandle) -> Result<(), String> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let dir = models_dir(app)?;
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("Failed to create models dir: {e}"))?;

    let dest = dir.join(MODEL_FILENAME);
    let partial = dir.join(format!("{MODEL_FILENAME}.partial"));

    log::info!("Downloading whisper model from {MODEL_URL}");

    let client = reqwest::Client::new();
    let response = client
        .get(MODEL_URL)
        .send()
        .await
        .map_err(|e| format!("Download request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("Download failed with status: {}", response.status()));
    }

    let total = response.content_length().unwrap_or(0);
    let mut stream = response.bytes_stream();
    let mut file = tokio::fs::File::create(&partial)
        .await
        .map_err(|e| format!("Failed to create file: {e}"))?;

    let mut downloaded: u64 = 0;
    let mut last_emit_percent: u32 = 0;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download stream error: {e}"))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Write error: {e}"))?;
        downloaded += chunk.len() as u64;

        let percent = if total > 0 {
            (downloaded as f64 / total as f64 * 100.0) as u32
        } else {
            0
        };

        if percent != last_emit_percent {
            last_emit_percent = percent;
            let _ = app.emit(
                "whisper-download-progress",
                DownloadProgress {
                    downloaded,
                    total,
                    percent,
                },
            );
        }
    }

    file.flush()
        .await
        .map_err(|e| format!("Flush error: {e}"))?;

    tokio::fs::rename(&partial, &dest)
        .await
        .map_err(|e| format!("Failed to rename downloaded file: {e}"))?;

    log::info!("Whisper model downloaded: {} bytes", downloaded);
    Ok(())
}

#[tauri::command]
pub async fn transcribe_audio(
    audio_base64: String,
    language: Option<String>,
    state: State<'_, WhisperModelState>,
) -> Result<String, String> {
    use base64::Engine;

    let ctx = {
        let lock = state.context.lock().map_err(|e| e.to_string())?;
        lock.clone()
    };
    let ctx = ctx.ok_or("Whisper model not loaded. Call load_whisper_model first.")?;

    let raw_bytes = base64::engine::general_purpose::STANDARD
        .decode(&audio_base64)
        .map_err(|e| format!("Failed to decode audio base64: {e}"))?;

    if raw_bytes.len() < 4 {
        return Err("No audio data provided".to_string());
    }

    let audio_data: Vec<f32> = raw_bytes
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect();

    let lang = language.unwrap_or_else(|| "ja".to_string());
    log::info!(
        "Transcribing {} samples ({:.1}s) with language={}",
        audio_data.len(),
        audio_data.len() as f64 / 16000.0,
        lang
    );

    tokio::task::spawn_blocking(move || {
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_language(Some(&lang));
        params.set_n_threads(4);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_no_timestamps(true);
        params.set_suppress_blank(true);
        params.set_suppress_nst(true);
        params.set_temperature(0.0);
        params.set_single_segment(false);

        let mut whisper_state = ctx
            .create_state()
            .map_err(|e| format!("Failed to create whisper state: {e}"))?;

        whisper_state
            .full(params, &audio_data)
            .map_err(|e| format!("Transcription failed: {e}"))?;

        let mut text = String::new();
        for segment in whisper_state.as_iter() {
            text.push_str(&segment.to_string());
        }

        let result = text.trim().to_string();
        log::info!("Transcription result: {}", result);
        Ok(result)
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

#[tauri::command]
pub async fn delete_whisper_model(
    app: AppHandle,
    state: State<'_, WhisperModelState>,
) -> Result<(), String> {
    {
        let mut lock = state.context.lock().map_err(|e| e.to_string())?;
        *lock = None;
    }

    let path = model_path(&app)?;
    if path.exists() {
        tokio::fs::remove_file(&path)
            .await
            .map_err(|e| format!("Failed to delete model: {e}"))?;
        log::info!("Whisper model deleted");
    }

    Ok(())
}
