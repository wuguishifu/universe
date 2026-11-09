//! Records for a while, then saves a clip, without the app:
//!
//! cargo run -p clipper-capture --example record -- <seconds> <out.mp4>

use std::time::Duration;

use clipper_capture::{Recorder, RecorderConfig};

fn main() {
    let mut args = std::env::args().skip(1);
    let seconds: u64 = args.next().and_then(|s| s.parse().ok()).unwrap_or(10);
    let out = args.next().unwrap_or_else(|| "clip.mp4".into());

    let recorder = Recorder::start(RecorderConfig {
        ffmpeg: "ffmpeg".into(),
        work_dir: std::env::temp_dir().join("clipper-example"),
        window: Duration::from_secs(120),
        framerate: 60,
        video_bitrate: "30M".into(),
    });
    std::thread::sleep(Duration::from_secs(seconds));
    println!("{:?}", recorder.status());
    match recorder.save_clip(out.as_ref()) {
        Ok(()) => println!("saved {out}"),
        Err(e) => println!("failed: {e}"),
    }
}
