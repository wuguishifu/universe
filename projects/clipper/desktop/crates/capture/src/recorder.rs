//! The MVP replay buffer: ffmpeg captures the display (Desktop Duplication) or one window
//! (Windows.Graphics.Capture), encodes it on the GPU through Media Foundation, and muxes in
//! desktop audio piped from Rust, writing 2s MPEG-TS segments to a temp folder. Frames stay on
//! the GPU as D3D11 textures from capture to encoder. Old segments are deleted; saving a clip
//! joins the newest ones.
//!
//! If ffmpeg exits (a display mode change can end Desktop Duplication), it's started again in a
//! fresh folder, and clips come from the new run. Changing the source starts a new run too.

use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::audio;
use crate::window_list::{WindowInfo, window_exists};

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

/// What's recorded.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CaptureSource {
    /// The main display.
    #[default]
    Display,
    /// One window, wherever it is and whatever covers it.
    Window(WindowInfo),
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecorderStatus {
    pub recording: bool,
    pub source: CaptureSource,
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
    source: CaptureSource,
    run: Option<Run>,
    last_error: Option<String>,
}

struct Shared {
    config: RecorderConfig,
    state: Mutex<State>,
    child: Mutex<Option<Child>>,
    /// Set by stop(): the supervisor ends.
    stop: AtomicBool,
    /// Set by set_source(): the current run ends and the next starts right away.
    restart: AtomicBool,
}

impl Shared {
    fn kill_child(&self) {
        if let Some(mut child) = self.child.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    /// Whether the run ended because it was asked to, rather than failing.
    fn interrupted(&self) -> bool {
        self.stop.load(Ordering::Relaxed) || self.restart.load(Ordering::Relaxed)
    }
}

pub struct Recorder {
    shared: Arc<Shared>,
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

/// The segment being written is only joined once it holds this much. Before that it may be empty
/// or hold only the start of its first keyframe, and as the first input ffmpeg can't read it.
const MIN_PARTIAL_BYTES: u64 = 1024 * 1024;

/// The segments to join for a clip of up to `window`: the newest finished ones that add up to
/// at least `window` (or all of them), then the one being written if it holds enough
/// (`partial_bytes`) to be worth reading.
fn pick_segments(finished: &[Segment], window: Duration, partial_bytes: u64) -> Vec<String> {
    let mut total = 0.0;
    let mut start = finished.len();
    while start > 0 && total < window.as_secs_f64() {
        start -= 1;
        total += finished[start].end - finished[start].start;
    }
    let mut names: Vec<String> = finished[start..].iter().map(|s| s.name.clone()).collect();
    if partial_bytes >= MIN_PARTIAL_BYTES {
        names.push(segment_name(finished.len()));
    }
    names
}

impl Recorder {
    pub fn start(config: RecorderConfig, source: CaptureSource) -> Self {
        let _ = fs::remove_dir_all(&config.work_dir);
        let shared = Arc::new(Shared {
            config,
            state: Mutex::new(State {
                source,
                ..State::default()
            }),
            child: Mutex::default(),
            stop: AtomicBool::new(false),
            restart: AtomicBool::new(false),
        });
        let supervisor = shared.clone();
        thread::Builder::new()
            .name("recorder".into())
            .spawn(move || supervise(&supervisor))
            .expect("couldn't start the recorder thread");
        Self { shared }
    }

    pub fn status(&self) -> RecorderStatus {
        let state = self.shared.state.lock().unwrap();
        RecorderStatus {
            recording: state.run.is_some(),
            source: state.source.clone(),
            buffered_seconds: state.run.as_ref().map_or(0.0, |run| {
                run.started
                    .elapsed()
                    .min(self.shared.config.window)
                    .as_secs_f64()
            }),
            last_error: state.last_error.clone(),
        }
    }

    /// Records `source` from now on. What was buffered from the old source is dropped.
    pub fn set_source(&self, source: CaptureSource) {
        {
            let mut state = self.shared.state.lock().unwrap();
            if state.source == source {
                return;
            }
            state.source = source;
            state.last_error = None;
        }
        self.shared.restart.store(true, Ordering::Relaxed);
        self.shared.kill_child();
    }

    /// Joins the newest segments into `out` (an .mp4): up to the window, or since recording
    /// started if that's less. Takes a second or two for a full window.
    pub fn save_clip(&self, out: &Path) -> Result<(), String> {
        let (dir, source) = {
            let state = self.shared.state.lock().unwrap();
            let run = state.run.as_ref().ok_or("not recording")?;
            (run.dir.clone(), state.source.clone())
        };
        let finished = read_segments(&dir);
        let partial_bytes =
            fs::metadata(dir.join(segment_name(finished.len()))).map_or(0, |m| m.len());
        let names: Vec<String> = pick_segments(&finished, self.shared.config.window, partial_bytes)
            .into_iter()
            .filter(|name| dir.join(name).exists())
            .collect();
        if names.is_empty() {
            return Err(match source {
                CaptureSource::Display => {
                    "Nothing recorded yet: recording only just started. Try again in a moment."
                        .into()
                }
                CaptureSource::Window(window) => format!(
                    "Nothing recorded yet from \"{}\". Recording starts over when you switch \
                     windows, and a window is only recorded while what it shows is changing.",
                    window.title
                ),
            });
        }
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        let output = no_window(&mut Command::new(&self.shared.config.ffmpeg))
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
        self.shared.stop.store(true, Ordering::Relaxed);
        self.shared.kill_child();
    }
}

impl Drop for Recorder {
    fn drop(&mut self) {
        self.stop();
    }
}

/// The lavfi source for `source`. Both produce D3D11 frames, which h264_mf takes as they are.
fn video_input(source: &CaptureSource, framerate: u32) -> String {
    match source {
        CaptureSource::Display => format!("ddagrab=output_idx=0:framerate={framerate}"),
        // Windows.Graphics.Capture only sends a frame when the window changes, so fps fills
        // the gaps; width/height of -2 round the window's size down to even, which H.264 needs.
        CaptureSource::Window(window) => format!(
            "gfxcapture=hwnd={}:max_framerate={framerate}:width=-2:height=-2,fps={framerate}",
            window.hwnd
        ),
    }
}

fn ffmpeg_args(config: &RecorderConfig, source: &CaptureSource) -> Vec<String> {
    let gop = (config.framerate * SEGMENT_SECONDS / 2).to_string();
    [
        "-hide_banner",
        "-nostats",
        "-loglevel",
        "warning",
        "-y",
        "-f",
        "lavfi",
        "-i",
        &video_input(source, config.framerate),
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

fn supervise(shared: &Shared) {
    let mut attempt = 0u32;
    while !shared.stop.load(Ordering::Relaxed) {
        attempt += 1;
        shared.restart.store(false, Ordering::Relaxed);
        let dir = shared.config.work_dir.join(format!("run{attempt}"));
        let source = shared.state.lock().unwrap().source.clone();

        let result = match &source {
            CaptureSource::Window(window) if !window_exists(window.hwnd) => {
                Err(format!("\"{}\" was closed", window.title))
            }
            _ => run_once(shared, &dir, &source),
        };
        shared.state.lock().unwrap().run = None;
        let _ = fs::remove_dir_all(&dir);

        if let Err(e) = result {
            tracing::error!(error = %e, "recording stopped");
            let mut state = shared.state.lock().unwrap();
            // A window that's gone won't come back: record the display instead.
            if let CaptureSource::Window(window) = &state.source
                && !window_exists(window.hwnd)
            {
                state.last_error = Some(format!(
                    "\"{}\" was closed, so the display is recorded instead.",
                    window.title
                ));
                state.source = CaptureSource::Display;
                continue;
            }
            state.last_error = Some(e);
            drop(state);
            thread::sleep(Duration::from_secs(2));
        }
    }
}

fn run_once(shared: &Shared, dir: &Path, source: &CaptureSource) -> Result<(), String> {
    let config = &shared.config;
    fs::create_dir_all(dir).map_err(|e| format!("couldn't create {}: {e}", dir.display()))?;
    let log = fs::File::create(dir.join("ffmpeg.log")).map_err(|e| e.to_string())?;

    let mut child = no_window(&mut Command::new(&config.ffmpeg))
        .current_dir(dir)
        .args(ffmpeg_args(config, source))
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(log)
        .spawn()
        .map_err(|e| format!("couldn't start ffmpeg ({}): {e}", config.ffmpeg.display()))?;
    let stdin = child.stdin.take().ok_or("ffmpeg has no stdin")?;
    tracing::info!(dir = %dir.display(), ?source, "recording");

    let audio_stop = Arc::new(AtomicBool::new(false));
    let audio = {
        let stop = audio_stop.clone();
        thread::Builder::new()
            .name("desktop-audio".into())
            .spawn(move || audio::capture_loopback(stdin, stop))
            .map_err(|e| e.to_string())?
    };

    *shared.child.lock().unwrap() = Some(child);
    shared.state.lock().unwrap().run = Some(Run {
        dir: dir.to_owned(),
        started: Instant::now(),
    });

    // Wait for ffmpeg to exit, deleting old segments as it goes.
    let exit = loop {
        thread::sleep(Duration::from_millis(250));
        let mut slot = shared.child.lock().unwrap();
        let Some(child) = slot.as_mut() else {
            break None; // stop() or set_source() took it.
        };
        if let Ok(Some(status)) = child.try_wait() {
            slot.take();
            break Some(status);
        }
        drop(slot);
        delete_old_segments(dir, config.window + KEEP_EXTRA);
        if audio.is_finished() || shared.interrupted() {
            shared.kill_child();
        }
    };

    audio_stop.store(true, Ordering::Relaxed);
    let audio_result = audio.join().unwrap_or(Err("audio capture panicked".into()));
    if shared.interrupted() {
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

    const WINDOW: Duration = Duration::from_secs(120);

    #[test]
    fn picks_enough_segments_for_the_window() {
        let picked = pick_segments(&segments(100), WINDOW, MIN_PARTIAL_BYTES);
        // 60 finished segments of 2s, then the one being written.
        assert_eq!(picked.len(), 61);
        assert_eq!(picked.first().unwrap(), &segment_name(40));
        assert_eq!(picked.last().unwrap(), &segment_name(100));
    }

    #[test]
    fn picks_everything_when_there_is_less_than_the_window() {
        let picked = pick_segments(&segments(3), WINDOW, MIN_PARTIAL_BYTES);
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
            pick_segments(&[], WINDOW, MIN_PARTIAL_BYTES),
            vec![segment_name(0)]
        );
    }

    #[test]
    fn skips_a_segment_being_written_until_it_holds_enough() {
        // Just after a switch: nothing finished, and the first segment barely started.
        assert!(pick_segments(&[], WINDOW, 0).is_empty());
        assert!(pick_segments(&[], WINDOW, MIN_PARTIAL_BYTES - 1).is_empty());
        assert_eq!(
            pick_segments(&segments(2), WINDOW, 10),
            vec![segment_name(0), segment_name(1)]
        );
    }

    #[test]
    fn serializes_sources_with_a_kind() {
        let window = CaptureSource::Window(WindowInfo {
            hwnd: 42,
            title: "VALORANT".into(),
            exe: "VALORANT-Win64-Shipping.exe".into(),
            pid: 7,
        });
        let json = serde_json::to_string(&window).unwrap();
        assert_eq!(
            json,
            r#"{"kind":"window","hwnd":42,"title":"VALORANT","exe":"VALORANT-Win64-Shipping.exe","pid":7}"#
        );
        assert_eq!(
            serde_json::to_string(&CaptureSource::Display).unwrap(),
            r#"{"kind":"display"}"#
        );
    }
}
