//! Records for a while, then saves a clip, without the app:
//!
//! cargo run -p clipper-capture --example record -- <seconds> <out.mp4> [options]
//!
//!   --window <title>   record the first window whose title contains <title> (else the display)
//!   --app <name|pid>   add a track for an app playing audio (repeatable)
//!   --mic              add a microphone track
//!   --list             list the windows and audio apps that can be recorded
//!
//! There's always a Desktop track (everything the speakers play), first.

use std::time::Duration;

use clipper_capture::{
    AudioSource, CaptureSource, Recorder, RecorderConfig, list_audio_apps, list_windows,
};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "--list") {
        println!("windows:");
        for w in list_windows() {
            println!("  {:>10}  {:<32}  {}", w.hwnd, w.exe, w.title);
        }
        println!("audio apps:");
        for app in list_audio_apps().unwrap_or_default() {
            println!("  {:>10}  {}", app.pid, app.name);
        }
        return;
    }

    let seconds: u64 = args.first().and_then(|s| s.parse().ok()).unwrap_or(10);
    let out = args.get(1).cloned().unwrap_or_else(|| "clip.mp4".into());
    let mut source = CaptureSource::Display;
    let mut tracks = vec![AudioSource::Desktop];
    let mut rest = args.iter().skip(2);
    while let Some(arg) = rest.next() {
        match arg.as_str() {
            "--window" => {
                let title = rest.next().expect("--window needs a title");
                source = CaptureSource::Window(
                    list_windows()
                        .into_iter()
                        .find(|w| w.title.contains(title.as_str()))
                        .unwrap_or_else(|| panic!("no window titled like {title:?}")),
                );
            }
            "--app" => {
                let wanted = rest.next().expect("--app needs a name or pid");
                let app = list_audio_apps()
                    .unwrap_or_default()
                    .into_iter()
                    .find(|a| a.name.eq_ignore_ascii_case(wanted) || a.pid.to_string() == *wanted)
                    .unwrap_or_else(|| panic!("no audio app {wanted:?}; see --list"));
                tracks.push(AudioSource::App {
                    pid: app.pid,
                    name: app.name,
                });
            }
            "--mic" => tracks.push(AudioSource::Microphone),
            other => panic!("unknown option {other:?}"),
        }
    }
    println!("recording {source:?} with {tracks:?}");

    let recorder = Recorder::start(
        RecorderConfig {
            ffmpeg: "ffmpeg".into(),
            work_dir: std::env::temp_dir().join("clipper-example"),
            window: Duration::from_secs(120),
            framerate: 60,
            video_bitrate: "30M".into(),
        },
        source,
        tracks,
    );
    std::thread::sleep(Duration::from_secs(seconds));
    println!("{:?}", recorder.status());
    let started = std::time::Instant::now();
    match recorder.save_clip(out.as_ref()) {
        Ok(()) => println!("saved {out} in {:.1}s", started.elapsed().as_secs_f64()),
        Err(e) => println!("failed: {e}"),
    }
}
