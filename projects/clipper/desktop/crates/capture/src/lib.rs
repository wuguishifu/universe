//! Clipper's capture engine, kept apart from the Tauri app so it can be tested and benchmarked
//! without a UI.
//!
//! For now, [`Recorder`] has ffmpeg capture and encode the display or a window and write short
//! segments to disk, with an audio track per source from [`audio`] piped in. The plan is to move to
//! in-process capture, with each stream kept in its own [`ReplayBuffer`] of encoded packets on
//! one shared clock.

pub mod audio;
mod buffer;
mod process;
mod recorder;
mod time;
mod window_list;

pub use audio::{
    AudioApp, AudioSource, InputDevice, Levels, TrackState, TrackStates, list_audio_apps,
    list_input_devices,
};
pub use buffer::{Packet, ReplayBuffer};
pub use recorder::{CaptureSource, Recorder, RecorderConfig, RecorderStatus};
pub use time::Timestamp;
pub use window_list::{WindowInfo, list_windows, window_exists};
