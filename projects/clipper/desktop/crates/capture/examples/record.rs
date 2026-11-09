//! Records for a while, then saves a clip, without the app:
//!
//! cargo run -p clipper-capture --example record -- <seconds> <out.mp4> [window title]
//!
//! With a window title, the first window whose title contains it is recorded; otherwise the
//! display. With `--list`, lists the windows that can be recorded.

use std::time::Duration;

use clipper_capture::{CaptureSource, Recorder, RecorderConfig, list_windows};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().is_some_and(|a| a == "--list") {
        for w in list_windows() {
            println!("{:>10}  {:<32}  {}", w.hwnd, w.exe, w.title);
        }
        return;
    }
    let seconds: u64 = args.first().and_then(|s| s.parse().ok()).unwrap_or(10);
    let out = args.get(1).cloned().unwrap_or_else(|| "clip.mp4".into());
    let source = match args.get(2) {
        Some(title) => CaptureSource::Window(
            list_windows()
                .into_iter()
                .find(|w| w.title.contains(title.as_str()))
                .unwrap_or_else(|| panic!("no window titled like {title:?}")),
        ),
        None => CaptureSource::Display,
    };
    println!("recording {source:?}");

    let recorder = Recorder::start(
        RecorderConfig {
            ffmpeg: "ffmpeg".into(),
            work_dir: std::env::temp_dir().join("clipper-example"),
            window: Duration::from_secs(120),
            framerate: 60,
            video_bitrate: "30M".into(),
        },
        source,
    );
    std::thread::sleep(Duration::from_secs(seconds));
    println!("{:?}", recorder.status());
    match recorder.save_clip(out.as_ref()) {
        Ok(()) => println!("saved {out}"),
        Err(e) => println!("failed: {e}"),
    }
}
