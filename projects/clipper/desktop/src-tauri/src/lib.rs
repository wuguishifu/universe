use std::time::Duration;

use serde::Serialize;

/// How far back a clip can go.
const BUFFER: Duration = Duration::from_secs(120);

/// What the UI shows about the capture engine. Mirrored by `CaptureStatus` in src/lib/commands.ts.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Status {
    version: &'static str,
    buffer_seconds: u64,
    recording: bool,
}

#[tauri::command]
fn get_status() -> Status {
    Status {
        version: env!("CARGO_PKG_VERSION"),
        buffer_seconds: BUFFER.as_secs(),
        recording: false,
    }
}

pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,clipper_desktop_lib=debug,clipper_capture=debug".into()),
        )
        .init();

    tracing::info!(buffer_secs = BUFFER.as_secs(), "starting Clipper");

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_status])
        .run(tauri::generate_context!())
        .expect("error while running Clipper");
}
