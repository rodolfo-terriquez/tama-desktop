mod tts_manager;
mod voice_session;
mod whisper;

use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};
use tts_manager::TTSProcessState;
use voice_session::VoiceSessionState;
use whisper::WhisperModelState;

fn db_migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "Initial schema",
        sql: r#"
CREATE TABLE IF NOT EXISTS user_profile (
  id INTEGER PRIMARY KEY DEFAULT 1,
  jlpt_level TEXT NOT NULL DEFAULT 'N5',
  auto_adjust_level INTEGER NOT NULL DEFAULT 0,
  estimated_level TEXT NOT NULL DEFAULT 'beginner',
  response_length TEXT NOT NULL DEFAULT 'natural',
  interests TEXT NOT NULL DEFAULT '[]',
  topics_covered TEXT NOT NULL DEFAULT '[]',
  recent_struggles TEXT NOT NULL DEFAULT '[]',
  total_sessions INTEGER NOT NULL DEFAULT 0,
  voicevox_speaker_id INTEGER,
  voicevox_speaker_name TEXT
);

INSERT OR IGNORE INTO user_profile (id) VALUES (1);

CREATE TABLE IF NOT EXISTS vocab_items (
  id TEXT PRIMARY KEY,
  word TEXT NOT NULL,
  reading TEXT NOT NULL,
  meaning TEXT NOT NULL,
  example TEXT NOT NULL DEFAULT '',
  source_session TEXT NOT NULL DEFAULT '',
  interval_days REAL NOT NULL DEFAULT 1,
  ease_factor REAL NOT NULL DEFAULT 2.5,
  next_review TEXT NOT NULL,
  times_seen_in_conversation INTEGER NOT NULL DEFAULT 0,
  times_reviewed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  scenario TEXT NOT NULL,
  messages TEXT NOT NULL,
  feedback TEXT,
  duration_seconds INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS custom_scenarios (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  title_ja TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  setting TEXT NOT NULL DEFAULT '',
  character_role TEXT NOT NULL DEFAULT '',
  objectives TEXT NOT NULL DEFAULT '[]',
  custom_prompt TEXT
);

CREATE TABLE IF NOT EXISTS ongoing_chats (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  persona TEXT NOT NULL DEFAULT '',
  messages TEXT NOT NULL DEFAULT '[]',
  summary TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  last_active_at TEXT NOT NULL,
  total_messages INTEGER NOT NULL DEFAULT 0,
  last_feedback_at_total INTEGER NOT NULL DEFAULT 0
);
        "#,
        kind: MigrationKind::Up,
    }]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(WhisperModelState::new())
        .manage(TTSProcessState::new())
        .manage(VoiceSessionState::new())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:tama.db", db_migrations())
                .build(),
        )
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Auto-load Whisper model and auto-start VOICEVOX at startup
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let whisper_state = handle.state::<WhisperModelState>();
                whisper::auto_load_if_downloaded(&handle, &whisper_state).await;

                tts_manager::auto_start_voicevox(&handle).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            whisper::get_whisper_model_status,
            whisper::load_whisper_model,
            whisper::transcribe_audio,
            whisper::delete_whisper_model,
            tts_manager::voicevox_status,
            tts_manager::start_voicevox,
            tts_manager::stop_voicevox,
            tts_manager::download_voicevox,
            tts_manager::sbv2_status,
            tts_manager::start_sbv2,
            tts_manager::stop_sbv2,
            voice_session::start_voice_session,
            voice_session::stop_voice_session,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                eprintln!("[tama] Application exiting, cleaning up...");

                let voice_state = app_handle.state::<VoiceSessionState>();
                voice_state.shutdown();

                let tts_state = app_handle.state::<TTSProcessState>();
                tts_manager::shutdown(&tts_state);

                eprintln!("[tama] Cleanup complete");
            }
        });
}
