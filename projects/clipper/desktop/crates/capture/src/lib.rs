//! Clipper's capture engine, kept apart from the Tauri app so it can be tested and benchmarked
//! without a UI.
//!
//! Every stream (the video and each audio source) is captured and encoded on its own, stamped
//! with one shared clock, and kept in its own [`ReplayBuffer`]. Saving a clip takes the same
//! window from each buffer and hands the packets to ffmpeg to mux.

mod buffer;
mod time;

pub use buffer::{Packet, ReplayBuffer};
pub use time::Timestamp;
