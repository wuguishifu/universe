//! Records for a while, then saves a clip, without the app:
//!
//! cargo run -p clipper-capture --example record -- <seconds> <out.mp4> [options]
//!
//!   --window <title>   record the first window whose title contains <title> (else the display)
//!   --app <name|pid>   add a track for an app playing audio (repeatable)
//!   --program <name> <exe>...
//!                      add a track for whichever process runs one of <exe>, whenever it's
//!                      running, e.g. `--program Discord Discord.exe` (ends at the next option)
//!   --discord          add a Discord track
//!   --mic [name]       add a microphone track: the default input, or the first whose name
//!                      contains [name]
//!   --list             list the windows, audio apps and input devices
//!   --meter-inputs     meter every input device for a few seconds each, to find a live one
//!
//!   --no-desktop       leave out the Desktop track (everything the speakers play), which is
//!                      otherwise first

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use clipper_capture::{
    AudioSource, CaptureSource, Levels, Recorder, RecorderConfig, TrackState, TrackStates, audio,
    list_audio_apps, list_input_devices, list_windows,
};

fn db(peak: f32) -> f32 {
    20.0 * peak.max(1e-5).log10()
}

/// Each input device's loudest peak over a few seconds: one that's live shows its noise floor
/// (or you talking), a dead one -100 dB.
fn meter_inputs() {
    for device in list_input_devices().unwrap_or_default() {
        let stop = Arc::new(AtomicBool::new(false));
        let levels = Levels::default();
        let track = AudioSource::Microphone {
            device: Some(device.id.clone()),
        };
        let thread = {
            let (stop, levels) = (stop.clone(), levels.clone());
            std::thread::spawn(move || {
                audio::capture(
                    &[track],
                    std::io::sink(),
                    stop,
                    levels,
                    TrackStates::default(),
                )
            })
        };
        let mut loudest = 0f32;
        for _ in 0..30 {
            std::thread::sleep(Duration::from_millis(100));
            loudest = loudest.max(levels.lock().unwrap().first().copied().unwrap_or(0.0));
        }
        stop.store(true, Ordering::Relaxed);
        let _ = thread.join();
        let default = match (device.is_default, device.is_communications_default) {
            (true, true) => " (default, calls default)",
            (true, false) => " (default)",
            (false, true) => " (calls default)",
            _ => "",
        };
        println!("  peak {:>5.0} dB  {}{default}", db(loudest), device.name);
    }
}

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
        println!("input devices:");
        for d in list_input_devices().unwrap_or_default() {
            let default = if d.is_default { " (default)" } else { "" };
            println!("  {}{default}  {}", d.name, d.id);
        }
        return;
    }
    if args.iter().any(|a| a == "--meter-inputs") {
        meter_inputs();
        return;
    }

    let seconds: u64 = args.first().and_then(|s| s.parse().ok()).unwrap_or(10);
    let out = args.get(1).cloned().unwrap_or_else(|| "clip.mp4".into());
    let mut source = CaptureSource::Display;
    let mut tracks = vec![AudioSource::Desktop];
    let mut rest = args.iter().skip(2).peekable();
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
            "--program" => {
                let name = rest.next().expect("--program needs a name").clone();
                let mut exes = Vec::new();
                while let Some(exe) = rest.next_if(|a| !a.starts_with("--")) {
                    exes.push(exe.clone());
                }
                tracks.push(AudioSource::Program { name, exes });
            }
            "--discord" => tracks.push(AudioSource::discord()),
            "--no-desktop" => tracks.retain(|t| *t != AudioSource::Desktop),
            "--mic" => {
                let device = rest.next_if(|a| !a.starts_with("--")).map(|wanted| {
                    // A device ID as it is, e.g. one that isn't plugged in.
                    if wanted.starts_with('{') {
                        return wanted.clone();
                    }
                    list_input_devices()
                        .unwrap_or_default()
                        .into_iter()
                        .find(|d| d.name.to_lowercase().contains(&wanted.to_lowercase()))
                        .unwrap_or_else(|| panic!("no input device like {wanted:?}; see --list"))
                        .id
                });
                tracks.push(AudioSource::Microphone { device });
            }
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
    // Each track's peak once a second, in dBFS, and why it's silent if it is: a quick check
    // that a source is being heard.
    for _ in 0..seconds {
        std::thread::sleep(Duration::from_secs(1));
        let status = recorder.status();
        let levels = recorder.levels();
        let tracks: Vec<String> = status
            .tracks
            .iter()
            .enumerate()
            .map(|(i, track)| {
                let peak = db(levels.get(i).copied().unwrap_or(0.0));
                match status.track_states.get(i) {
                    Some(TrackState::Waiting { reason } | TrackState::Unavailable { reason }) => {
                        format!("{} {peak:.0} dB ({reason})", track.title())
                    }
                    _ => format!("{} {peak:.0} dB", track.title()),
                }
            })
            .collect();
        println!("levels: {}", tracks.join(", "));
    }
    println!("{:?}", recorder.status());
    let started = std::time::Instant::now();
    match recorder.save_clip(out.as_ref()) {
        Ok(()) => println!("saved {out} in {:.1}s", started.elapsed().as_secs_f64()),
        Err(e) => println!("failed: {e}"),
    }
}
