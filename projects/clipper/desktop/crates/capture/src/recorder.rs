//! The MVP replay buffer: ffmpeg captures the screen (Desktop Duplication, encoded on the GPU
//! through Media Foundation) and muxes in desktop audio piped from Rust, writing 2s MPEG-TS
//! segments to a temp folder. Old segments are deleted; saving a clip joins the newest ones.
//!
//! If ffmpeg exits (a display mode change can end Desktop Duplication), it's started again in a
//! fresh folder, and clips come from the new run.

use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use crate::audio;

/// Each segment's length, and the most a clip can run past the time asked for.
const SEGMENT_SECONDS: u32 = 2;
/// Segments older than the window plus this are deleted.
const KEEP_EXTRA: Duration = Duration::from_secs(10);
const LIST_FILE: &str = "segments.csv";

#[derive(Clone, Debug)]
pub struct RecorderConfig {
    /// The ffmpeg executable.
    pub ffmpeg: PathBuf,
    /// Where segments are written; cleared on start.
    pub work_dir: PathBuf,
    /// How far back a clip can go.
    pub window: Duration,
    pub framerate: u32,
    pub video_bitrate: String,
}

#[derive(Clone, Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecorderStatus {
    pub recording: bool,
    /// How much a clip saved now would hold.
    pub buffered_seconds: f64,
    pub last_error: Option<String>,
}

struct Run {
    dir: PathBuf,
    started: Instant,
}

#[derive(Default)]
struct State {
    run: Option<Run>,
    last_error: Option<String>,
}

pub struct Recorder {
    config: RecorderConfig,
    state: Arc<Mutex<State>>,
    stop: Arc<AtomicBool>,
    child: Arc<Mutex<Option<Child>>>,
}

#[derive(Debug, Clone, PartialEq)]
struct Segment {
    name: String,
    start: f64,
    end: f64,
}

fn no_window(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

fn segment_name(index: usize) -> String {
    format!("seg{index:06}.ts")
}

/// The finished segments ffmpeg has listed, oldest first.
fn read_segments(dir: &Path) -> Vec<Segment> {
    let Ok(file) = fs::File::open(dir.join(LIST_FILE)) else {
        return Vec::new();
    };
    BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .filter_map(|line| {
            let mut parts = line.split(',');
            Some(Segment {
                name: parts.next()?.to_owned(),
                start: parts.next()?.parse().ok()?,
                end: parts.next()?.parse().ok()?,
            })
        })
        .collect()
}

/// The segments to join for a clip of up to `window`: the newest finished ones that add up to
/// at least `window` (or all of them), then the one being written.
fn pick_segments(finished: &[Segment], window: Duration) -> Vec<String> {
    let mut total = 0.0;
    let mut start = finished.len();
    while start > 0 && total < window.as_secs_f64() {
        start -= 1;
        total += finished[start].end - finished[start].start;
    }
    let mut names: Vec<String> = finished[start..].iter().map(|s| s.name.clone()).collect();
    names.push(segment_name(finished.len()));
    names
}

impl Recorder {
    pub fn start(config: RecorderConfig) -> Self {
        let recorder = Self {
            config,
            state: Arc::default(),
            stop: Arc::new(AtomicBool::new(false)),
            child: Arc::default(),
        };
        let _ = fs::remove_dir_all(&recorder.config.work_dir);

        let config = recorder.config.clone();
        let state = recorder.state.clone();
        let stop = recorder.stop.clone();
        let child = recorder.child.clone();
        thread::Builder::new()
            .name("recorder".into())
            .spawn(move || supervise(config, state, stop, child))
            .expect("couldn't start the recorder thread");
        recorder
    }

    pub fn status(&self) -> RecorderStatus {
        let state = self.state.lock().unwrap();
        RecorderStatus {
            recording: state.run.is_some(),
            buffered_seconds: state.run.as_ref().map_or(0.0, |run| {
                run.started.elapsed().min(self.config.window).as_secs_f64()
            }),
            last_error: state.last_error.clone(),
        }
    }

    /// Joins the newest segments into `out` (an .mp4): up to the window, or since recording
    /// started if that's less. Takes a second or two for a full window.
    pub fn save_clip(&self, out: &Path) -> Result<(), String> {
        let dir = {
            let state = self.state.lock().unwrap();
            let run = state.run.as_ref().ok_or("not recording")?;
            run.dir.clone()
        };
        let names = pick_segments(&read_segments(&dir), self.config.window);
        let names: Vec<String> = names
            .into_iter()
            .filter(|name| dir.join(name).exists())
            .collect();
        if names.is_empty() {
            return Err("nothing recorded yet".into());
        }
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        let output = no_window(&mut Command::new(&self.config.ffmpeg))
            .current_dir(&dir)
            .args(["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i"])
            .arg(format!("concat:{}", names.join("|")))
            .args(["-map", "0", "-c", "copy", "-movflags", "+faststart"])
            .arg(out)
            .output()
            .map_err(|e| format!("couldn't run ffmpeg: {e}"))?;
        if !output.status.success() || !out.exists() {
            return Err(format!(
                "ffmpeg couldn't save the clip: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        Ok(())
    }

    pub fn stop(&self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(mut child) = self.child.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for Recorder {
    fn drop(&mut self) {
        self.stop();
    }
}

fn ffmpeg_args(config: &RecorderConfig) -> Vec<String> {
    let gop = (config.framerate * SEGMENT_SECONDS / 2).to_string();
    [
        "-hide_banner",
        "-nostats",
        "-loglevel",
        "warning",
        "-y",
        // Video: Desktop Duplication of the main display, kept on the GPU (D3D11 frames).
        "-f",
        "lavfi",
        "-i",
        &format!("ddagrab=output_idx=0:framerate={}", config.framerate),
        // Audio: raw PCM from capture_loopback on stdin.
        "-thread_queue_size",
        "4096",
        "-f",
        "f32le",
        "-ar",
        &audio::SAMPLE_RATE.to_string(),
        "-ac",
        &audio::CHANNELS.to_string(),
        "-i",
        "pipe:0",
        "-map",
        "0:v",
        "-map",
        "1:a",
        // The GPU's Media Foundation encoder takes D3D11 frames as they are.
        "-c:v",
        "h264_mf",
        "-hw_encoding",
        "1",
        "-b:v",
        &config.video_bitrate,
        "-g",
        &gop,
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-metadata:s:a:0",
        "title=Desktop",
        // Ends when stdin does, so ffmpeg never outlives the app.
        "-shortest",
        "-f",
        "segment",
        "-segment_time",
        &SEGMENT_SECONDS.to_string(),
        "-segment_format",
        "mpegts",
        "-segment_list",
        LIST_FILE,
        "-segment_list_type",
        "csv",
        "seg%06d.ts",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}

fn supervise(
    config: RecorderConfig,
    state: Arc<Mutex<State>>,
    stop: Arc<AtomicBool>,
    child_slot: Arc<Mutex<Option<Child>>>,
) {
    let mut attempt = 0u32;
    while !stop.load(Ordering::Relaxed) {
        attempt += 1;
        let dir = config.work_dir.join(format!("run{attempt}"));
        if let Err(e) = run_once(&config, &dir, &state, &stop, &child_slot) {
            tracing::error!(error = %e, "recording stopped");
            state.lock().unwrap().last_error = Some(e);
        }
        state.lock().unwrap().run = None;
        let _ = fs::remove_dir_all(&dir);
        if !stop.load(Ordering::Relaxed) {
            thread::sleep(Duration::from_secs(2));
        }
    }
}

fn run_once(
    config: &RecorderConfig,
    dir: &Path,
    state: &Mutex<State>,
    stop: &Arc<AtomicBool>,
    child_slot: &Mutex<Option<Child>>,
) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("couldn't create {}: {e}", dir.display()))?;
    let log = fs::File::create(dir.join("ffmpeg.log")).map_err(|e| e.to_string())?;

    let mut child = no_window(&mut Command::new(&config.ffmpeg))
        .current_dir(dir)
        .args(ffmpeg_args(config))
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(log)
        .spawn()
        .map_err(|e| format!("couldn't start ffmpeg ({}): {e}", config.ffmpeg.display()))?;
    let stdin = child.stdin.take().ok_or("ffmpeg has no stdin")?;
    tracing::info!(dir = %dir.display(), "recording");

    let run_stop = Arc::new(AtomicBool::new(false));
    let audio_stop = run_stop.clone();
    let audio = thread::Builder::new()
        .name("desktop-audio".into())
        .spawn(move || audio::capture_loopback(stdin, audio_stop))
        .map_err(|e| e.to_string())?;

    *child_slot.lock().unwrap() = Some(child);
    {
        let mut state = state.lock().unwrap();
        state.run = Some(Run {
            dir: dir.to_owned(),
            started: Instant::now(),
        });
        state.last_error = None;
    }

    // Wait for ffmpeg to exit, deleting old segments as it goes.
    let exit = loop {
        thread::sleep(Duration::from_secs(1));
        let mut slot = child_slot.lock().unwrap();
        let Some(child) = slot.as_mut() else {
            break None; // stop() took it.
        };
        if let Ok(Some(status)) = child.try_wait() {
            slot.take();
            break Some(status);
        }
        drop(slot);
        delete_old_segments(dir, config.window + KEEP_EXTRA);
        if (audio.is_finished() || stop.load(Ordering::Relaxed))
            && let Some(mut child) = child_slot.lock().unwrap().take()
        {
            let _ = child.kill();
            let _ = child.wait();
        }
    };

    run_stop.store(true, Ordering::Relaxed);
    let audio_result = audio.join().unwrap_or(Err("audio capture panicked".into()));
    if stop.load(Ordering::Relaxed) {
        return Ok(());
    }
    let log = fs::read_to_string(dir.join("ffmpeg.log")).unwrap_or_default();
    let tail: Vec<&str> = log.lines().rev().take(5).collect();
    Err(match (audio_result, exit) {
        (Err(e), _) => format!("desktop audio stopped: {e}"),
        (Ok(()), status) => format!(
            "ffmpeg exited ({}): {}",
            status.map_or("killed".into(), |s| s.to_string()),
            tail.into_iter().rev().collect::<Vec<_>>().join(" / ")
        ),
    })
}

fn delete_old_segments(dir: &Path, keep: Duration) {
    let segments = read_segments(dir);
    let Some(newest) = segments.last().map(|s| s.end) else {
        return;
    };
    for segment in &segments {
        if newest - segment.end > keep.as_secs_f64() {
            let _ = fs::remove_file(dir.join(&segment.name));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn segments(n: usize) -> Vec<Segment> {
        (0..n)
            .map(|i| Segment {
                name: segment_name(i),
                start: (i * 2) as f64,
                end: (i * 2 + 2) as f64,
            })
            .collect()
    }

    #[test]
    fn picks_enough_segments_for_the_window() {
        let picked = pick_segments(&segments(100), Duration::from_secs(120));
        // 60 finished segments of 2s, then the one being written.
        assert_eq!(picked.len(), 61);
        assert_eq!(picked.first().unwrap(), &segment_name(40));
        assert_eq!(picked.last().unwrap(), &segment_name(100));
    }

    #[test]
    fn picks_everything_when_there_is_less_than_the_window() {
        let picked = pick_segments(&segments(3), Duration::from_secs(120));
        assert_eq!(
            picked,
            vec![
                segment_name(0),
                segment_name(1),
                segment_name(2),
                segment_name(3)
            ]
        );
        assert_eq!(
            pick_segments(&[], Duration::from_secs(120)),
            vec![segment_name(0)]
        );
    }
}
