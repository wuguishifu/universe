//! Clipper's capture engine, kept apart from the Tauri app so it can be tested and benchmarked
//! without a UI.
//!
//! For now, [`Recorder`] has ffmpeg capture and encode the screen and write short segments to
//! disk, with desktop audio from [`audio`] piped in. The plan is to move to in-process capture,
//! with each stream kept in its own [`ReplayBuffer`] of encoded packets on one shared clock.

pub mod audio;
mod buffer;
mod recorder;
mod time;

pub use buffer::{Packet, ReplayBuffer};
pub use recorder::{Recorder, RecorderConfig, RecorderStatus};
pub use time::Timestamp;
