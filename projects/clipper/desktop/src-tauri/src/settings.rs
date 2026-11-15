//! The user's settings.
//!
//! The UI owns them: they're a Redux slice, saved by redux-persist into a Tauri store file. Rust
//! reads that file once at launch, so recording starts with the right tracks before the UI has
//! loaded (or without it), and is sent every change after that by the UI (`apply_settings`).

use clipper_capture::{AudioSource, CaptureSource};
use serde::Deserialize;

/// The store file, in the app's data folder (`%APPDATA%\com.wuguishifu.clipper`).
pub const STORE_FILE: &str = "preferences.json";
/// The key redux-persist keeps the settings slice under.
pub const STORE_KEY: &str = "persist:settings";

/// Mirrors the settings slice in src/store/settings.ts. Fields the UI keeps that Rust doesn't
/// need (and redux-persist's own `_persist`) are ignored; missing ones take their defaults.
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub audio: AudioSettings,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AudioSettings {
    /// A track of the recorded window's app.
    pub game: bool,
    /// A track of Discord, whether or not it's running yet.
    pub discord: bool,
    pub microphone: bool,
    /// The input device the microphone track records (an `InputDevice::id`), or `None` for
    /// Windows' default.
    pub microphone_device: Option<String>,
}

impl Default for AudioSettings {
    fn default() -> Self {
        Self {
            game: true,
            discord: true,
            microphone: false,
            microphone_device: None,
        }
    }
}

/// The settings from what redux-persist saved, or the defaults if there's nothing (yet), or it
/// can't be read.
pub fn from_store(saved: Option<serde_json::Value>) -> Settings {
    saved
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_default()
}

/// The tracks to record. The display gets Desktop (which has every app in it, Discord too) and
/// the microphone. A window gets the tracks switched on: the game, Discord, the microphone.
/// Tracks for a program that isn't running, or a microphone that isn't connected, are recorded
/// as silence until it is.
pub fn tracks_for(source: &CaptureSource, settings: &Settings) -> Vec<AudioSource> {
    let audio = &settings.audio;
    let mut tracks = Vec::new();
    match source {
        CaptureSource::Display => tracks.push(AudioSource::Desktop),
        CaptureSource::Window(window) => {
            if audio.game {
                tracks.push(AudioSource::App {
                    pid: window.pid,
                    name: "Game".into(),
                });
            }
            if audio.discord {
                tracks.push(AudioSource::discord());
            }
        }
    }
    if audio.microphone {
        tracks.push(AudioSource::Microphone {
            device: audio.microphone_device.clone(),
        });
    }
    tracks
}

#[cfg(test)]
mod tests {
    use clipper_capture::WindowInfo;
    use serde_json::json;

    use super::*;

    fn window() -> CaptureSource {
        CaptureSource::Window(WindowInfo {
            hwnd: 1,
            title: "VALORANT".into(),
            exe: "VALORANT-Win64-Shipping.exe".into(),
            pid: 5,
        })
    }

    fn titles(tracks: &[AudioSource]) -> Vec<&str> {
        tracks.iter().map(AudioSource::title).collect()
    }

    #[test]
    fn records_the_switched_on_tracks_for_a_window() {
        let mut settings = Settings::default();
        settings.audio.microphone = true;
        assert_eq!(
            titles(&tracks_for(&window(), &settings)),
            ["Game", "Discord", "Microphone"]
        );
        settings.audio.game = false;
        settings.audio.discord = false;
        assert_eq!(titles(&tracks_for(&window(), &settings)), ["Microphone"]);
        settings.audio.microphone = false;
        assert!(tracks_for(&window(), &settings).is_empty());
    }

    #[test]
    fn records_desktop_and_the_mic_for_the_display() {
        let mut settings = Settings::default();
        settings.audio.microphone = true;
        // Game and Discord are in Desktop already.
        assert_eq!(
            titles(&tracks_for(&CaptureSource::Display, &settings)),
            ["Desktop", "Microphone"]
        );
    }

    #[test]
    fn reads_what_redux_persist_saved() {
        let saved = json!({
            "audio": {
                "game": false,
                "discord": true,
                "microphone": true,
                "microphoneDevice": "{0.0.1.00000000}.{c603}",
                "microphoneDeviceName": "Microphone (Shure MV7)"
            },
            "_persist": { "version": 1, "rehydrated": true }
        });
        let settings = from_store(Some(saved));
        assert!(!settings.audio.game && settings.audio.discord && settings.audio.microphone);
        assert_eq!(
            settings.audio.microphone_device.as_deref(),
            Some("{0.0.1.00000000}.{c603}")
        );
        // Nothing saved, or something unreadable: the defaults.
        assert_eq!(from_store(None), Settings::default());
        assert_eq!(from_store(Some(json!("nonsense"))), Settings::default());
        // A setting added later, missing from an old file, takes its default.
        let old = from_store(Some(json!({ "audio": { "microphone": true } })));
        assert!(old.audio.microphone && old.audio.game && old.audio.discord);
    }
}
