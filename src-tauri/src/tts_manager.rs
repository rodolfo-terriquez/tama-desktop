use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

const VOICEVOX_PORT: u16 = 50021;
const VOICEVOX_VERSION: &str = "0.25.1";

pub struct TTSProcessState {
    voicevox_pid: Mutex<Option<u32>>,
    sbv2_pid: Mutex<Option<u32>>,
    voicevox_downloading: AtomicBool,
}

impl TTSProcessState {
    pub fn new() -> Self {
        Self {
            voicevox_pid: Mutex::new(None),
            sbv2_pid: Mutex::new(None),
            voicevox_downloading: AtomicBool::new(false),
        }
    }
}

// ── Serializable response types ─────────────────────────────────────

#[derive(Clone, Serialize)]
pub struct VoicevoxStatus {
    running: bool,
    installed: bool,
    path: Option<String>,
    pid: Option<u32>,
    managed_by_us: bool,
    can_download: bool,
    platform: String,
    download: VoicevoxDownloadState,
}

#[derive(Clone, Serialize, Default)]
pub struct VoicevoxDownloadState {
    in_progress: bool,
    progress: u32,
    total_size: u64,
    downloaded_size: u64,
    status: String,
    error: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct SBV2Status {
    running: bool,
    pid: Option<u32>,
    managed_by_us: bool,
    installed: bool,
    python: Option<String>,
    has_models: bool,
    port: u16,
}

/// Kill any TTS processes we launched. Called on app exit.
pub fn shutdown(state: &TTSProcessState) {
    if let Ok(mut pid_lock) = state.voicevox_pid.lock() {
        if let Some(pid) = pid_lock.take() {
            log::info!("Shutting down managed VOICEVOX (pid {})", pid);
            let _ = kill_pid(pid);
        }
    }
    // Also kill anything still listening on the VOICEVOX port
    // in case the tracked PID was stale (e.g. launched via `open -a`)
    if let Some(pid) = find_pid_on_port(VOICEVOX_PORT) {
        log::info!("Killing leftover process on VOICEVOX port (pid {})", pid);
        let _ = kill_pid(pid);
    }

    if let Ok(mut pid_lock) = state.sbv2_pid.lock() {
        if let Some(pid) = pid_lock.take() {
            log::info!("Shutting down managed SBV2 (pid {})", pid);
            let _ = kill_pid(pid);
        }
    }
}

// ── Platform helpers ────────────────────────────────────────────────

fn get_platform_key() -> String {
    let os = if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "unknown"
    };
    let arch = if cfg!(target_arch = "aarch64") {
        "arm64"
    } else if cfg!(target_arch = "x86_64") {
        "x64"
    } else {
        "unknown"
    };
    format!("{os}-{arch}")
}

fn get_engine_dir_name() -> &'static str {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    return "macos-arm64";
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    return "macos-x64";
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    return "linux-cpu-x64";
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    return "linux-cpu-arm64";
    #[cfg(not(any(
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "aarch64"),
    )))]
    return "unknown";
}

fn home_dir() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/tmp"))
}

/// Walk up from the executable to find the project root (contains package.json).
fn find_project_root() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let mut dir = exe.parent()?;
    for _ in 0..6 {
        if dir.join("package.json").exists() {
            return Some(dir.to_path_buf());
        }
        dir = dir.parent()?;
    }
    None
}

fn voicevox_engine_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    Ok(data_dir.join("engines").join("voicevox"))
}

// ── VOICEVOX path discovery ─────────────────────────────────────────

fn find_voicevox_path(app: &AppHandle) -> Option<PathBuf> {
    let engine_dir = get_engine_dir_name();
    let home = home_dir();

    let mut paths: Vec<PathBuf> = Vec::new();

    // App data directory (downloaded by Tauri app)
    if let Ok(data) = voicevox_engine_data_dir(app) {
        paths.push(data.join(engine_dir).join("run"));
    }

    // Project-local engine directory (legacy / dev mode)
    if let Some(root) = find_project_root() {
        paths.push(root.join("voicevox-engine").join(engine_dir).join("run"));
    }

    // Well-known project directory (for when running from a bundled .app
    // and find_project_root can't locate the project)
    let well_known_project = home
        .join("Documents/GitHub/tama-desktop/voicevox-engine")
        .join(engine_dir)
        .join("run");
    paths.push(well_known_project);

    // macOS common paths
    #[cfg(target_os = "macos")]
    {
        paths.push(PathBuf::from(
            "/Applications/VOICEVOX.app/Contents/MacOS/run",
        ));
        paths.push(home.join("Applications/VOICEVOX.app/Contents/MacOS/run"));
    }

    // Linux common paths
    #[cfg(target_os = "linux")]
    {
        paths.push(PathBuf::from("/usr/share/voicevox/run"));
        paths.push(home.join(".local/share/voicevox/run"));
    }

    // Also check for .app bundles on macOS
    #[cfg(target_os = "macos")]
    {
        let app_paths = [
            PathBuf::from("/Applications/VOICEVOX.app"),
            home.join("Applications/VOICEVOX.app"),
        ];
        for p in &app_paths {
            if p.exists() {
                return Some(p.clone());
            }
        }
    }

    let found = paths.iter().find(|p| p.exists()).cloned();
    if let Some(ref p) = found {
        log::info!("Found VOICEVOX engine at: {}", p.display());
    }
    found
}

// ── Auto-start on app launch ─────────────────────────────────────────

pub async fn auto_start_voicevox(app: &AppHandle) {
    if is_voicevox_running().await {
        eprintln!("[tama] VOICEVOX already running");
        return;
    }

    let voicevox_path = match find_voicevox_path(app) {
        Some(p) => p,
        None => {
            eprintln!("[tama] VOICEVOX not installed, skipping auto-start");
            return;
        }
    };

    eprintln!("[tama] Auto-starting VOICEVOX from: {}", voicevox_path.display());

    let child = if voicevox_path.extension().is_some_and(|e| e == "app")
        || voicevox_path.to_string_lossy().contains(".app")
    {
        Command::new("open")
            .args(["-a", &voicevox_path.to_string_lossy(), "--args", "--no-window"])
            .spawn()
    } else {
        let engine_dir = match voicevox_path.parent() {
            Some(d) => d.to_path_buf(),
            None => return,
        };
        Command::new(&voicevox_path)
            .args(["--host", "127.0.0.1"])
            .current_dir(&engine_dir)
            .env("DYLD_LIBRARY_PATH", &engine_dir)
            .spawn()
    };

    match child {
        Ok(child) => {
            let state = app.state::<TTSProcessState>();
            if let Ok(mut pid_lock) = state.voicevox_pid.lock() {
                *pid_lock = Some(child.id());
            }

            for _ in 0..60 {
                tokio::time::sleep(Duration::from_millis(500)).await;
                if is_voicevox_running().await {
                    eprintln!("[tama] VOICEVOX auto-started successfully");
                    let _ = app.emit("voicevox-status-changed", true);
                    return;
                }
            }
            eprintln!("[tama] VOICEVOX launched but did not respond in 30s");
        }
        Err(e) => {
            eprintln!("[tama] Failed to auto-start VOICEVOX: {e}");
        }
    }
}

// ── HTTP / process helpers ──────────────────────────────────────────

async fn is_voicevox_running() -> bool {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .unwrap_or_default();
    client
        .get(format!("http://localhost:{VOICEVOX_PORT}/version"))
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

async fn is_sbv2_running(port: u16) -> bool {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .unwrap_or_default();
    match client
        .get(format!("http://localhost:{port}/models/info"))
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => {
            // Verify it returns valid JSON (AirPlay on port 5000 returns binary plist)
            r.text()
                .await
                .map(|t| serde_json::from_str::<serde_json::Value>(&t).is_ok())
                .unwrap_or(false)
        }
        _ => false,
    }
}

fn find_pid_on_port(port: u16) -> Option<u32> {
    let output = Command::new("lsof")
        .args(["-ti", &format!(":{port}")])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    text.trim().lines().next()?.parse().ok()
}

fn find_listening_pid_on_port(port: u16) -> Option<u32> {
    let output = Command::new("lsof")
        .args(["-ti", &format!(":{port}"), "-sTCP:LISTEN"])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    text.trim().lines().next()?.parse().ok()
}

fn kill_pid(pid: u32) -> Result<(), String> {
    let _ = Command::new("kill")
        .arg(pid.to_string())
        .status()
        .map_err(|e| format!("Failed to send SIGTERM: {e}"))?;

    for _ in 0..10 {
        std::thread::sleep(Duration::from_millis(500));
        let check = Command::new("kill")
            .args(["-0", &pid.to_string()])
            .status();
        if check.is_err() || !check.unwrap().success() {
            return Ok(());
        }
    }

    // Force kill
    let _ = Command::new("kill")
        .args(["-9", &pid.to_string()])
        .status();
    Ok(())
}

fn find_7z() -> Option<String> {
    if let Ok(output) = Command::new("which").arg("7z").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(path);
            }
        }
    }
    let homebrew_paths = ["/opt/homebrew/bin/7z", "/usr/local/bin/7z"];
    for p in &homebrew_paths {
        if std::path::Path::new(p).exists() {
            return Some(p.to_string());
        }
    }
    None
}


// ── SBV2 path helpers ───────────────────────────────────────────────

fn find_python() -> Option<String> {
    if let Some(root) = find_project_root() {
        let venv_py = root.join(".venv").join("bin").join("python3");
        if venv_py.exists() {
            return Some(venv_py.to_string_lossy().to_string());
        }
    }

    for cmd in &["python3", "python"] {
        if let Ok(output) = Command::new(cmd).arg("--version").output() {
            let text = String::from_utf8_lossy(&output.stdout);
            if output.status.success() && text.contains("Python 3") {
                return Some(cmd.to_string());
            }
        }
    }
    None
}

fn check_sbv2_installed(python: &str) -> bool {
    Command::new(python)
        .args(["-c", "import style_bert_vits2"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn sbv2_has_models() -> bool {
    let models_dir = find_project_root()
        .map(|r| r.join("sbv2-models"))
        .unwrap_or_else(|| PathBuf::from("sbv2-models"));
    if let Ok(entries) = std::fs::read_dir(&models_dir) {
        return entries
            .filter_map(|e| e.ok())
            .any(|e| e.file_type().map(|ft| ft.is_dir()).unwrap_or(false));
    }
    false
}

fn sbv2_server_path() -> Option<PathBuf> {
    find_project_root().map(|r| r.join("server").join("sbv2_api.py"))
}

fn sbv2_models_path() -> Option<PathBuf> {
    find_project_root().map(|r| r.join("sbv2-models"))
}

// ── VOICEVOX Commands ───────────────────────────────────────────────

#[tauri::command]
pub async fn voicevox_status(
    app: AppHandle,
    state: State<'_, TTSProcessState>,
) -> Result<VoicevoxStatus, String> {
    let running = is_voicevox_running().await;
    let path = find_voicevox_path(&app);
    let pid = find_pid_on_port(VOICEVOX_PORT);
    let managed = state
        .voicevox_pid
        .lock()
        .map(|p| p.is_some())
        .unwrap_or(false);
    let can_download = get_engine_dir_name() != "unknown";
    let is_downloading = state.voicevox_downloading.load(Ordering::Relaxed);

    Ok(VoicevoxStatus {
        running,
        installed: path.is_some(),
        path: path.map(|p| p.to_string_lossy().to_string()),
        pid,
        managed_by_us: managed,
        can_download,
        platform: get_platform_key(),
        download: VoicevoxDownloadState {
            in_progress: is_downloading,
            status: if is_downloading {
                "downloading".to_string()
            } else {
                "idle".to_string()
            },
            ..Default::default()
        },
    })
}

#[tauri::command]
pub async fn start_voicevox(
    app: AppHandle,
    state: State<'_, TTSProcessState>,
) -> Result<(), String> {
    if is_voicevox_running().await {
        return Ok(());
    }

    let voicevox_path =
        find_voicevox_path(&app).ok_or("VOICEVOX not found. Use download_voicevox to install.")?;

    log::info!("Starting VOICEVOX from: {}", voicevox_path.display());

    let child = if voicevox_path.extension().is_some_and(|e| e == "app")
        || voicevox_path.to_string_lossy().contains(".app")
    {
        // macOS .app bundle
        Command::new("open")
            .args(["-a", &voicevox_path.to_string_lossy(), "--args", "--no-window"])
            .spawn()
            .map_err(|e| format!("Failed to launch VOICEVOX: {e}"))?
    } else {
        // Direct executable
        let engine_dir = voicevox_path
            .parent()
            .ok_or("Invalid engine path")?
            .to_path_buf();
        Command::new(&voicevox_path)
            .args(["--host", "127.0.0.1"])
            .current_dir(&engine_dir)
            .env("DYLD_LIBRARY_PATH", &engine_dir)
            .spawn()
            .map_err(|e| format!("Failed to launch VOICEVOX: {e}"))?
    };

    {
        let mut pid_lock = state.voicevox_pid.lock().map_err(|e| e.to_string())?;
        *pid_lock = Some(child.id());
    }

    // Wait for VOICEVOX to become responsive (up to 30s)
    for _ in 0..60 {
        tokio::time::sleep(Duration::from_millis(500)).await;
        if is_voicevox_running().await {
            log::info!("VOICEVOX started successfully");
            let _ = app.emit("voicevox-status-changed", true);
            return Ok(());
        }
    }

    Err("VOICEVOX launched but did not respond within 30 seconds".to_string())
}

#[tauri::command]
pub async fn stop_voicevox(app: AppHandle, state: State<'_, TTSProcessState>) -> Result<(), String> {
    let pid = find_pid_on_port(VOICEVOX_PORT);
    if let Some(pid) = pid {
        tokio::task::spawn_blocking(move || kill_pid(pid))
            .await
            .map_err(|e| format!("Task error: {e}"))??;
    }

    let mut pid_lock = state.voicevox_pid.lock().map_err(|e| e.to_string())?;
    *pid_lock = None;

    log::info!("VOICEVOX stopped");
    let _ = app.emit("voicevox-status-changed", false);
    Ok(())
}

#[tauri::command]
pub async fn download_voicevox(
    app: AppHandle,
    state: State<'_, TTSProcessState>,
) -> Result<(), String> {
    if find_voicevox_path(&app).is_some() {
        return Ok(());
    }

    if state
        .voicevox_downloading
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::Relaxed)
        .is_err()
    {
        return Err("Download already in progress".to_string());
    }

    let result = download_voicevox_inner(&app).await;
    state.voicevox_downloading.store(false, Ordering::Relaxed);
    result
}

async fn download_voicevox_inner(app: &AppHandle) -> Result<(), String> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let engine_dir = get_engine_dir_name();
    if engine_dir == "unknown" {
        return Err(format!(
            "Unsupported platform: {}",
            get_platform_key()
        ));
    }

    let seven_zip = find_7z().ok_or(
        "7z is not installed. Install with: brew install p7zip (macOS) or apt install p7zip-full (Linux)"
    )?;

    let download_url = format!(
        "https://github.com/VOICEVOX/voicevox_engine/releases/download/{VOICEVOX_VERSION}/voicevox_engine-{engine_dir}-{VOICEVOX_VERSION}.7z.001"
    );

    let dest_dir = voicevox_engine_data_dir(app)?;
    tokio::fs::create_dir_all(&dest_dir)
        .await
        .map_err(|e| format!("Failed to create dir: {e}"))?;

    let archive_path = dest_dir.join("voicevox_engine.7z.001");

    // Emit starting
    let _ = app.emit(
        "voicevox-download-progress",
        VoicevoxDownloadState {
            in_progress: true,
            status: "downloading".to_string(),
            ..Default::default()
        },
    );

    log::info!("Downloading VOICEVOX from {download_url}");

    let client = reqwest::Client::new();
    let response = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Download failed with status: {}",
            response.status()
        ));
    }

    let total = response.content_length().unwrap_or(0);
    let mut stream = response.bytes_stream();
    let mut file = tokio::fs::File::create(&archive_path)
        .await
        .map_err(|e| format!("Failed to create file: {e}"))?;

    let mut downloaded: u64 = 0;
    let mut last_percent: u32 = 0;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream error: {e}"))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Write error: {e}"))?;
        downloaded += chunk.len() as u64;

        let percent = if total > 0 {
            (downloaded as f64 / total as f64 * 100.0) as u32
        } else {
            0
        };

        if percent != last_percent {
            last_percent = percent;
            let _ = app.emit(
                "voicevox-download-progress",
                VoicevoxDownloadState {
                    in_progress: true,
                    progress: percent,
                    total_size: total,
                    downloaded_size: downloaded,
                    status: "downloading".to_string(),
                    error: None,
                },
            );
        }
    }

    file.flush()
        .await
        .map_err(|e| format!("Flush error: {e}"))?;
    drop(file);

    // Extract with 7z
    let _ = app.emit(
        "voicevox-download-progress",
        VoicevoxDownloadState {
            in_progress: true,
            progress: 100,
            status: "extracting".to_string(),
            ..Default::default()
        },
    );

    log::info!("Extracting VOICEVOX archive...");

    let dest_dir_clone = dest_dir.clone();
    let archive_clone = archive_path.clone();
    let seven_zip_clone = seven_zip.clone();
    tokio::task::spawn_blocking(move || {
        let status = Command::new(&seven_zip_clone)
            .args([
                "x",
                &archive_clone.to_string_lossy(),
                &format!("-o{}", dest_dir_clone.to_string_lossy()),
                "-y",
            ])
            .output()
            .map_err(|e| format!("7z extraction failed: {e}"))?;

        if !status.status.success() {
            let stderr = String::from_utf8_lossy(&status.stderr);
            return Err(format!("7z extraction failed: {stderr}"));
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("Task error: {e}"))??;

    // Clean up archive
    let _ = tokio::fs::remove_file(&archive_path).await;

    let _ = app.emit(
        "voicevox-download-progress",
        VoicevoxDownloadState {
            in_progress: false,
            progress: 100,
            status: "complete".to_string(),
            ..Default::default()
        },
    );

    log::info!("VOICEVOX engine downloaded and extracted");
    Ok(())
}

// ── SBV2 Commands ───────────────────────────────────────────────────

#[tauri::command]
pub async fn sbv2_status(
    port: Option<u16>,
    state: State<'_, TTSProcessState>,
) -> Result<SBV2Status, String> {
    let port = port.unwrap_or(5001);
    let running = is_sbv2_running(port).await;
    let pid = find_listening_pid_on_port(port);
    let python = find_python();
    let installed = python
        .as_ref()
        .map(|p| check_sbv2_installed(p))
        .unwrap_or(false);
    let has_models = sbv2_has_models();
    let managed = state
        .sbv2_pid
        .lock()
        .map(|p| p.is_some())
        .unwrap_or(false);

    Ok(SBV2Status {
        running,
        pid,
        managed_by_us: managed,
        installed,
        python,
        has_models,
        port,
    })
}

#[tauri::command]
pub async fn start_sbv2(
    port: Option<u16>,
    state: State<'_, TTSProcessState>,
) -> Result<(), String> {
    let port = port.unwrap_or(5001);

    if is_sbv2_running(port).await {
        return Ok(());
    }

    let python = find_python().ok_or(
        "Python 3 not found. Install a Python 3 venv: python3 -m venv .venv && source .venv/bin/activate",
    )?;

    if !check_sbv2_installed(&python) {
        return Err(
            "style_bert_vits2 not installed. Run: pip install style-bert-vits2 fastapi uvicorn"
                .to_string(),
        );
    }

    let server_path = sbv2_server_path().ok_or("Cannot find server/sbv2_api.py")?;
    let models_path = sbv2_models_path().ok_or("Cannot find sbv2-models/")?;

    if !sbv2_has_models() {
        return Err("No voice models found in sbv2-models/".to_string());
    }

    log::info!("Starting SBV2 with {} on port {port}", python);

    let child = Command::new(&python)
        .args([
            server_path.to_string_lossy().as_ref(),
            "--port",
            &port.to_string(),
            "--models",
            models_path.to_string_lossy().as_ref(),
        ])
        .env("CMAKE_POLICY_VERSION_MINIMUM", "3.5")
        .spawn()
        .map_err(|e| format!("Failed to start SBV2: {e}"))?;

    {
        let mut pid_lock = state.sbv2_pid.lock().map_err(|e| e.to_string())?;
        *pid_lock = Some(child.id());
    }

    // Wait for SBV2 to respond (model loading can take 30-120s)
    for _ in 0..120 {
        tokio::time::sleep(Duration::from_secs(1)).await;
        if is_sbv2_running(port).await {
            log::info!("SBV2 started on port {port}");
            return Ok(());
        }
    }

    Err("SBV2 launched but did not respond within 2 minutes. Model loading may still be in progress.".to_string())
}

#[tauri::command]
pub async fn stop_sbv2(
    port: Option<u16>,
    state: State<'_, TTSProcessState>,
) -> Result<(), String> {
    let port = port.unwrap_or(5001);

    let pid = find_listening_pid_on_port(port);
    if let Some(pid) = pid {
        tokio::task::spawn_blocking(move || kill_pid(pid))
            .await
            .map_err(|e| format!("Task error: {e}"))??;
    }

    let mut pid_lock = state.sbv2_pid.lock().map_err(|e| e.to_string())?;
    *pid_lock = None;

    log::info!("SBV2 stopped on port {port}");
    Ok(())
}
