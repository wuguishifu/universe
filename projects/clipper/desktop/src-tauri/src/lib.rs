use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use clipper_capture::{
    AudioApp, AudioSource, CaptureSource, Recorder, RecorderConfig, WindowInfo, list_audio_apps,
    list_windows,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, RunEvent};
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};

/// How far back a clip can go.
const BUFFER: Duration = Duration::from_secs(120);
/// Saves a clip from anywhere, including from inside a game.
const SAVE_SHORTCUT: (Modifiers, Code, &str) = (Modifiers::ALT, Code::F9, "Alt+F9");

/// The audio tracks asked for, beyond the ones that are always there. Mirrored by
/// `TrackSettings` in commands.ts.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrackSettings {
    microphone: bool,
    /// Apps that get a track of their own, e.g. Discord.
    apps: Vec<AudioApp>,
}

/// The tracks to record: Desktop, the recorded window's app, the other apps asked for, then
/// the microphone.
fn tracks_for(source: &CaptureSource, settings: &TrackSettings) -> Vec<AudioSource> {
    let mut tracks = vec![AudioSource::Desktop];
    if let CaptureSource::Window(window) = source {
        tracks.push(AudioSource::App {
            pid: window.pid,
            name: window.title.clone(),
        });
    }
    for app in &settings.apps {
        let already = tracks
            .iter()
            .any(|t| matches!(t, AudioSource::App { pid, .. } if *pid == app.pid));
        if !already {
            tracks.push(AudioSource::App {
                pid: app.pid,
                name: app.name.clone(),
            });
        }
    }
    if settings.microphone {
        tracks.push(AudioSource::Microphone);
    }
    tracks
}

struct AppState {
    recorder: Recorder,
    clips_dir: PathBuf,
    tracks: Mutex<TrackSettings>,
    /// Set while a clip is being written, so a second press doesn't start another.
    saving: Mutex<bool>,
}

/// What the UI shows about the capture engine. Mirrored by `CaptureStatus` in src/lib/commands.ts.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Status {
    version: &'static str,
    buffer_seconds: u64,
    recording: bool,
    source: CaptureSource,
    tracks: Vec<AudioSource>,
    track_settings: TrackSettings,
    track_warnings: Vec<String>,
    buffered_seconds: f64,
    last_error: Option<String>,
    clips_dir: String,
    shortcut: &'static str,
}

/// Sent to the UI as `clip-saved` or `clip-failed`. Mirrored by `ClipEvent` in commands.ts.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClipEvent {
    path: Option<String>,
    error: Option<String>,
}

#[tauri::command]
fn get_status(state: tauri::State<AppState>) -> Status {
    let recorder = state.recorder.status();
    Status {
        version: env!("CARGO_PKG_VERSION"),
        buffer_seconds: BUFFER.as_secs(),
        recording: recorder.recording,
        source: recorder.source,
        tracks: recorder.tracks,
        track_settings: state.tracks.lock().unwrap().clone(),
        track_warnings: recorder.track_warnings,
        buffered_seconds: recorder.buffered_seconds,
        last_error: recorder.last_error,
        clips_dir: state.clips_dir.display().to_string(),
        shortcut: SAVE_SHORTCUT.2,
    }
}

#[tauri::command]
fn list_capture_windows() -> Vec<WindowInfo> {
    list_windows()
}

/// Switches what's recorded. The buffer starts over.
#[tauri::command]
fn set_source(state: tauri::State<AppState>, source: CaptureSource) {
    let tracks = tracks_for(&source, &state.tracks.lock().unwrap());
    state.recorder.set_capture(source, tracks);
}

/// Apps playing audio, which can each get a track.
#[tauri::command]
fn list_capture_audio_apps() -> Result<Vec<AudioApp>, String> {
    list_audio_apps()
}

/// Changes the extra audio tracks. The buffer starts over.
#[tauri::command]
fn set_tracks(state: tauri::State<AppState>, settings: TrackSettings) {
    let source = state.recorder.status().source;
    let tracks = tracks_for(&source, &settings);
    *state.tracks.lock().unwrap() = settings;
    state.recorder.set_capture(source, tracks);
}

#[tauri::command]
fn save_clip(app: AppHandle) {
    save_clip_in_background(&app);
}

/// A sound, so a save can be heard from inside a game.
fn beep(ok: bool) {
    use windows::Win32::System::Diagnostics::Debug::MessageBeep;
    use windows::Win32::UI::WindowsAndMessaging::{MB_ICONHAND, MB_OK};
    unsafe {
        let _ = MessageBeep(if ok { MB_OK } else { MB_ICONHAND });
    }
}

/// What a clip's file name starts with: the window's title, or "Clipper" for the display.
fn clip_name(source: &CaptureSource) -> String {
    let title = match source {
        CaptureSource::Display => "",
        CaptureSource::Window(window) => &window.title,
    };
    let name: String = title
        .chars()
        // Characters Windows doesn't allow in file names.
        .filter(|c| !"<>:\"/\\|?*".contains(*c) && !c.is_control())
        .take(60)
        .collect();
    match name.trim() {
        "" => "Clipper".into(),
        name => name.into(),
    }
}

fn save_clip_in_background(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let state = app.state::<AppState>();
        {
            let mut saving = state.saving.lock().unwrap();
            if *saving {
                return;
            }
            *saving = true;
        }
        let name = format!(
            "{} {}.mp4",
            clip_name(&state.recorder.status().source),
            chrono::Local::now().format("%Y-%m-%d %H-%M-%S")
        );
        let path = state.clips_dir.join(name);
        let result = state.recorder.save_clip(&path);
        *state.saving.lock().unwrap() = false;

        let event = match result {
            Ok(()) => {
                tracing::info!(path = %path.display(), "saved clip");
                beep(true);
                (
                    "clip-saved",
                    ClipEvent {
                        path: Some(path.display().to_string()),
                        error: None,
                    },
                )
            }
            Err(e) => {
                tracing::error!(error = %e, "couldn't save clip");
                beep(false);
                (
                    "clip-failed",
                    ClipEvent {
                        path: None,
                        error: Some(e),
                    },
                )
            }
        };
        let _ = app.emit(event.0, event.1);
    });
}

pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,clipper_desktop_lib=debug,clipper_capture=debug".into()),
        )
        .init();

    let shortcut = Shortcut::new(Some(SAVE_SHORTCUT.0), SAVE_SHORTCUT.1);

    let app = tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, pressed, event| {
                    if pressed == &shortcut && event.state() == ShortcutState::Pressed {
                        save_clip_in_background(app);
                    }
                })
                .build(),
        )
        .setup(move |app| {
            let paths = app.path();
            let clips_dir = paths.video_dir()?.join("Clipper");
            let work_dir = paths.app_local_data_dir()?.join("buffer");
            // Set CLIPPER_FFMPEG to use a particular build; otherwise ffmpeg on PATH.
            let ffmpeg = std::env::var_os("CLIPPER_FFMPEG").map_or("ffmpeg".into(), PathBuf::from);
            tracing::info!(clips = %clips_dir.display(), buffer = %work_dir.display(), "starting Clipper");

            let recorder = Recorder::start(
                RecorderConfig {
                    ffmpeg,
                    work_dir,
                    window: BUFFER,
                    framerate: 60,
                    video_bitrate: "30M".into(),
                },
                CaptureSource::Display,
                tracks_for(&CaptureSource::Display, &TrackSettings::default()),
            );
            app.manage(AppState {
                recorder,
                clips_dir,
                tracks: Mutex::default(),
                saving: Mutex::new(false),
            });

            use tauri_plugin_global_shortcut::GlobalShortcutExt;
            if let Err(e) = app.global_shortcut().register(shortcut) {
                tracing::error!(error = %e, shortcut = SAVE_SHORTCUT.2, "couldn't register the save shortcut");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_status,
            list_capture_windows,
            set_source,
            list_capture_audio_apps,
            set_tracks,
            save_clip
        ])
        .build(tauri::generate_context!())
        .expect("error while building Clipper");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            app.state::<AppState>().recorder.stop();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn window(pid: u32) -> CaptureSource {
        CaptureSource::Window(WindowInfo {
            hwnd: 1,
            title: "VALORANT".into(),
            exe: "VALORANT-Win64-Shipping.exe".into(),
            pid,
        })
    }

    #[test]
    fn records_desktop_alone_by_default() {
        let tracks = tracks_for(&CaptureSource::Display, &TrackSettings::default());
        assert_eq!(tracks, vec![AudioSource::Desktop]);
    }

    #[test]
    fn adds_the_window_app_then_other_apps_then_the_mic() {
        let settings = TrackSettings {
            microphone: true,
            apps: vec![
                AudioApp {
                    pid: 7,
                    name: "Discord".into(),
                },
                // The recorded window's own app isn't added twice.
                AudioApp {
                    pid: 5,
                    name: "VALORANT-Win64-Shipping".into(),
                },
            ],
        };
        let titles: Vec<String> = tracks_for(&window(5), &settings)
            .iter()
            .map(|t| t.title().to_owned())
            .collect();
        assert_eq!(titles, ["Desktop", "VALORANT", "Discord", "Microphone"]);
    }
}
