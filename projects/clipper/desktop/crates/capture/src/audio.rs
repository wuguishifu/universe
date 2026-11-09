//! Audio: one WASAPI capture per source (everything the speakers play, one app's audio, or the
//! microphone), written out together as one continuous stream of interleaved raw PCM, two
//! channels per source. Sharing one stream keeps the tracks in step with each other; ffmpeg
//! splits it back into a track per source.

use std::collections::VecDeque;
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use wasapi::{AudioClient, DeviceEnumerator, Direction, SampleType, StreamMode, WaveFormat};

pub const SAMPLE_RATE: u32 = 48_000;
/// Per source.
pub const CHANNELS: u16 = 2;
/// One source's frame: 32-bit float samples, as ffmpeg's `f32le`.
const BYTES_PER_FRAME: usize = 4 * CHANNELS as usize;

/// How far behind the clock the stream is written, so every source has delivered its audio
/// for a moment before that moment is written out. A source with nothing by then is silent.
const LATENCY: Duration = Duration::from_millis(60);
/// A source holding more than this beyond what's been written (its clock runs fast, or it
/// delivered a burst) has its oldest audio dropped.
const MAX_QUEUED: Duration = Duration::from_millis(250);
const POLL: Duration = Duration::from_millis(10);

/// Somewhere audio comes from. Each is its own track.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AudioSource {
    /// Everything the default output device plays.
    Desktop,
    /// An input device: the one with this [`InputDevice::id`], or Windows' default.
    Microphone { device: Option<String> },
    /// What one process (and its children) plays.
    App { pid: u32, name: String },
}

impl AudioSource {
    /// The track's title in a saved clip.
    pub fn title(&self) -> &str {
        match self {
            Self::Desktop => "Desktop",
            Self::Microphone { .. } => "Microphone",
            Self::App { name, .. } => name,
        }
    }

    /// Whether the track goes into a clip's mix. Apps don't, as Desktop already has them.
    pub fn in_mix(&self) -> bool {
        !matches!(self, Self::App { .. })
    }
}

fn frames(duration: Duration) -> usize {
    (duration.as_secs_f64() * f64::from(SAMPLE_RATE)) as usize
}

type Queue = Arc<Mutex<VecDeque<u8>>>;

/// The largest sample magnitude in `bytes` (f32le), 0 to 1 for audio that isn't clipping.
fn peak(bytes: &[u8]) -> f32 {
    bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|b| f32::from_le_bytes(*b).abs())
        .filter(|s| s.is_finite())
        .fold(0.0, f32::max)
}

/// How long a meter holds a peak before falling to the current level, so a short sound can be
/// seen by a UI that only looks a few times a second.
const PEAK_HOLD: Duration = Duration::from_millis(300);

/// Each track's recent peak, for level meters: a sample magnitude, 0 to 1.
pub type Levels = Arc<Mutex<Vec<f32>>>;

/// Takes `n` frames from each queue and interleaves them: frame 0 of every source, then frame
/// 1, and so on. A source with fewer than `n` frames is padded with silence at the end. Returns
/// each source's peak in what was taken.
fn interleave(queues: &[Queue], n: usize, out: &mut Vec<u8>) -> Vec<f32> {
    let stride = BYTES_PER_FRAME * queues.len();
    out.clear();
    out.resize(n * stride, 0);
    let mut peaks = Vec::with_capacity(queues.len());
    for (i, queue) in queues.iter().enumerate() {
        let mut queue = queue.lock().unwrap();
        let available = (queue.len() / BYTES_PER_FRAME).min(n);
        let taken: Vec<u8> = queue.drain(..available * BYTES_PER_FRAME).collect();
        peaks.push(peak(&taken));
        for (frame, bytes) in taken.as_chunks::<BYTES_PER_FRAME>().0.iter().enumerate() {
            let at = frame * stride + i * BYTES_PER_FRAME;
            out[at..at + BYTES_PER_FRAME].copy_from_slice(bytes);
        }
        let excess = queue
            .len()
            .saturating_sub(frames(MAX_QUEUED) * BYTES_PER_FRAME);
        let excess = excess - excess % BYTES_PER_FRAME;
        queue.drain(..excess);
    }
    peaks
}

/// Captures every source and writes them to `out` as one interleaved `f32le` stream at
/// [`SAMPLE_RATE`], with [`CHANNELS`] per source in the order given, until `stop` is set or a
/// write fails.
///
/// The stream runs on the wall clock: one second of output is always one second of time, which
/// keeps it in step with the video it's muxed with. Sources that deliver nothing (loopback while
/// nothing plays, an app that's quiet, a source that failed to start) are written as silence.
/// A source that fails is reported to `warn` and stays silent; the others carry on. Each
/// source's recent peak is kept in `levels`, in the same order.
pub fn capture(
    sources: &[AudioSource],
    mut out: impl Write,
    stop: Arc<AtomicBool>,
    levels: Levels,
    warn: impl Fn(String) + Send + Sync + 'static,
) -> Result<(), String> {
    let warn = Arc::new(warn);
    let queues: Vec<Queue> = sources.iter().map(|_| Queue::default()).collect();
    let threads: Vec<_> = sources
        .iter()
        .zip(&queues)
        .map(|(source, queue)| {
            let (source, queue, stop, warn) =
                (source.clone(), queue.clone(), stop.clone(), warn.clone());
            thread::Builder::new()
                .name(format!("audio: {}", source.title()))
                .spawn(move || {
                    if let Err(e) = capture_source(&source, &queue, &stop) {
                        tracing::warn!(track = source.title(), error = %e, "audio track is silent");
                        warn(format!("{}: {e}", source.title()));
                    }
                })
        })
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;

    let stride = BYTES_PER_FRAME * sources.len();
    let result = (|| {
        // The audio's first sample is its time zero, as the video's first frame is the video's.
        // ffmpeg opens the video source first (Windows.Graphics.Capture takes ~300ms) and only
        // then reads stdin, so stamping audio from when it was written would make it late by
        // that much. Instead, silence fills the pipe until a write blocks: that's ffmpeg
        // starting to read, which is when the clock starts.
        let primed = prime(&mut out, stride)?;
        let start = Instant::now();
        let primed_for = Duration::from_secs_f64(primed as f64 / f64::from(SAMPLE_RATE));
        // The silence stands in for the first `primed_for` after that; what's captured in that
        // time is dropped, so everything after lands at the time it was captured.
        let mut dropped_early_audio = false;
        let mut written = primed;
        let mut buf = Vec::new();
        let mut held: Vec<(f32, Instant)> = vec![(0.0, start); sources.len()];
        while !stop.load(Ordering::Relaxed) {
            thread::sleep(POLL);
            if !dropped_early_audio && start.elapsed() >= primed_for {
                for queue in &queues {
                    queue.lock().unwrap().clear();
                }
                dropped_early_audio = true;
            }
            let target = frames(start.elapsed().saturating_sub(LATENCY));
            if target <= written {
                continue;
            }
            let peaks = interleave(&queues, target - written, &mut buf);
            let now = Instant::now();
            for ((level, at), peak) in held.iter_mut().zip(peaks) {
                if peak >= *level || now - *at > PEAK_HOLD {
                    (*level, *at) = (peak, now);
                }
            }
            *levels.lock().unwrap() = held.iter().map(|(level, _)| *level).collect();
            out.write_all(&buf).map_err(|e| e.to_string())?;
            out.flush().map_err(|e| e.to_string())?;
            written = target;
        }
        Ok(())
    })();

    stop.store(true, Ordering::Relaxed);
    for thread in threads {
        let _ = thread.join();
    }
    result
}

/// Writes silence until a write blocks for a moment, meaning the pipe was full until its reader
/// started reading. Returns how many frames were written. Stops after a few pipe buffers' worth
/// if nothing blocks (the reader was already reading).
fn prime(out: &mut impl Write, stride: usize) -> Result<usize, String> {
    // Windows pipes buffer 64KB; this is well past that.
    const MAX_BYTES: usize = 256 * 1024;
    const BLOCKED: Duration = Duration::from_millis(20);
    let chunk_frames = (4096 / stride).max(1);
    let chunk = vec![0u8; chunk_frames * stride];
    let mut frames = 0;
    while frames * stride < MAX_BYTES {
        let started = Instant::now();
        out.write_all(&chunk).map_err(|e| e.to_string())?;
        out.flush().map_err(|e| e.to_string())?;
        frames += chunk_frames;
        if started.elapsed() >= BLOCKED {
            tracing::debug!(
                waited_ms = started.elapsed().as_millis() as u64,
                "audio clock started"
            );
            break;
        }
    }
    Ok(frames)
}

fn wasapi_err(what: &'static str) -> impl Fn(wasapi::WasapiError) -> String {
    move |e| format!("{what} ({e})")
}

/// Opens the client a source is captured from: loopback of the output device, the input
/// device, or process loopback of one app.
fn open(source: &AudioSource) -> Result<(AudioClient, bool), String> {
    let format = WaveFormat::new(
        32,
        32,
        SampleType::Float,
        SAMPLE_RATE as usize,
        CHANNELS as usize,
        None,
    );
    let (mut client, mode, events) = match source {
        AudioSource::Desktop | AudioSource::Microphone { .. } => {
            let enumerator =
                DeviceEnumerator::new().map_err(wasapi_err("couldn't list audio devices"))?;
            let device = match source {
                AudioSource::Microphone {
                    device: Some(id), ..
                } => enumerator
                    .get_device(id)
                    .map_err(wasapi_err("the chosen microphone isn't available"))?,
                AudioSource::Microphone { device: None } => enumerator
                    .get_default_device(Direction::Capture)
                    .map_err(wasapi_err("no default input device"))?,
                _ => enumerator
                    .get_default_device(Direction::Render)
                    .map_err(wasapi_err("no default output device"))?,
            };
            tracing::info!(
                track = source.title(),
                device = %device.get_friendlyname().unwrap_or_default(),
                "capturing"
            );
            let client = device
                .get_iaudioclient()
                .map_err(wasapi_err("couldn't open the device"))?;
            // Polled: loopback doesn't signal events on older Windows builds. A 1s buffer leaves
            // room for a slow read.
            let mode = StreamMode::PollingShared {
                autoconvert: true,
                buffer_duration_hns: 10_000_000,
            };
            (client, mode, false)
        }
        AudioSource::App { pid, name } => {
            tracing::info!(track = %name, pid, "capturing");
            let client = AudioClient::new_application_loopback_client(*pid, true)
                .map_err(wasapi_err("couldn't capture the app"))?;
            // Process loopback only works event-driven.
            let mode = StreamMode::EventsShared {
                autoconvert: true,
                buffer_duration_hns: 0,
            };
            (client, mode, true)
        }
    };
    // Capturing from a render device is loopback.
    client
        .initialize_client(&format, Direction::Capture, mode, None)
        .map_err(wasapi_err("couldn't start capturing"))?;
    Ok((client, events))
}

fn capture_source(source: &AudioSource, queue: &Queue, stop: &AtomicBool) -> Result<(), String> {
    let hr = wasapi::initialize_mta();
    if hr.is_err() {
        return Err(format!("couldn't initialize COM ({hr:?})"));
    }
    let (client, events) = open(source)?;
    let event = if events {
        Some(
            client
                .set_get_eventhandle()
                .map_err(wasapi_err("couldn't start capturing"))?,
        )
    } else {
        None
    };
    let capture = client
        .get_audiocaptureclient()
        .map_err(wasapi_err("couldn't start capturing"))?;
    client
        .start_stream()
        .map_err(wasapi_err("couldn't start capturing"))?;

    let mut local = VecDeque::new();
    let result = (|| {
        while !stop.load(Ordering::Relaxed) {
            match &event {
                // Quiet apps send no events; the timeout keeps `stop` checked.
                Some(event) => {
                    let _ = event.wait_for_event(20);
                }
                None => thread::sleep(POLL / 2),
            }
            while capture
                .get_next_packet_size()
                .map_err(wasapi_err("stopped"))?
                .unwrap_or(0)
                > 0
            {
                capture
                    .read_from_device_to_deque(&mut local)
                    .map_err(wasapi_err("stopped"))?;
            }
            if !local.is_empty() {
                queue.lock().unwrap().extend(local.drain(..));
            }
        }
        Ok(())
    })();
    let _ = client.stop_stream();
    result
}

/// A microphone, or any other input device.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputDevice {
    /// Windows' ID for the device, which stays the same across restarts.
    pub id: String,
    pub name: String,
    /// Whether it's Windows' default input device.
    pub is_default: bool,
    /// Whether it's the default for calls (what Discord and Teams use by default).
    pub is_communications_default: bool,
}

/// The input devices that are plugged in and enabled.
pub fn list_input_devices() -> Result<Vec<InputDevice>, String> {
    thread::spawn(|| {
        let _ = wasapi::initialize_mta();
        let enumerator = DeviceEnumerator::new().map_err(wasapi_err("couldn't list devices"))?;
        let default_id = |role| {
            enumerator
                .get_default_device_for_role(Direction::Capture, role)
                .and_then(|d| d.get_id())
                .ok()
        };
        let default = default_id(wasapi::Role::Console);
        let communications = default_id(wasapi::Role::Communications);
        let devices = enumerator
            .get_device_collection(Direction::Capture)
            .map_err(wasapi_err("couldn't list devices"))?;
        let mut list = Vec::new();
        for i in 0..devices.get_nbr_devices().unwrap_or(0) {
            let Ok(device) = devices.get_device_at_index(i) else {
                continue;
            };
            let Ok(id) = device.get_id() else { continue };
            list.push(InputDevice {
                is_default: default.as_ref() == Some(&id),
                is_communications_default: communications.as_ref() == Some(&id),
                name: device.get_friendlyname().unwrap_or_else(|_| id.clone()),
                id,
            });
        }
        Ok(list)
    })
    .join()
    .unwrap_or_else(|_| Err("listing input devices panicked".into()))
}

/// An app with an audio session on the default output device: one that's playing, or has.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioApp {
    pub pid: u32,
    /// The executable's name without `.exe`, e.g. `Discord`.
    pub name: String,
}

/// The apps that can be captured as their own track, by name.
pub fn list_audio_apps() -> Result<Vec<AudioApp>, String> {
    // COM on a thread of its own: the caller may be a UI thread set up for another apartment.
    thread::spawn(|| {
        let _ = wasapi::initialize_mta();
        let sessions = DeviceEnumerator::new()
            .and_then(|e| e.get_default_device(Direction::Render))
            .and_then(|d| d.get_iaudiosessionmanager())
            .and_then(|m| m.get_audiosessionenumerator())
            .map_err(wasapi_err("couldn't list audio sessions"))?;
        let own_pid = std::process::id();
        let mut apps: Vec<AudioApp> = Vec::new();
        for i in 0..sessions.get_count().unwrap_or(0) {
            let Ok(pid) = sessions.get_session(i).and_then(|s| s.get_process_id()) else {
                continue;
            };
            // 0 is system sounds.
            if pid == 0 || pid == own_pid || apps.iter().any(|a| a.pid == pid) {
                continue;
            }
            let exe = crate::window_list::exe_name(pid);
            let name = exe.strip_suffix(".exe").unwrap_or(&exe);
            if !name.is_empty() {
                apps.push(AudioApp {
                    pid,
                    name: name.to_owned(),
                });
            }
        }
        apps.sort_by_key(|a| a.name.to_lowercase());
        Ok(apps)
    })
    .join()
    .unwrap_or_else(|_| Err("listing audio sessions panicked".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn queue(frames: &[u8]) -> Queue {
        // Each frame is BYTES_PER_FRAME copies of one marker byte.
        Arc::new(Mutex::new(
            frames.iter().flat_map(|&b| [b; BYTES_PER_FRAME]).collect(),
        ))
    }

    fn markers(out: &[u8]) -> Vec<u8> {
        out.as_chunks::<BYTES_PER_FRAME>()
            .0
            .iter()
            .map(|f| f[0])
            .collect()
    }

    #[test]
    fn interleaves_sources_frame_by_frame() {
        let queues = [queue(&[1, 2, 3]), queue(&[7, 8, 9])];
        let mut out = Vec::new();
        interleave(&queues, 3, &mut out);
        assert_eq!(markers(&out), vec![1, 7, 2, 8, 3, 9]);
        assert!(queues.iter().all(|q| q.lock().unwrap().is_empty()));
    }

    #[test]
    fn pads_a_short_source_with_silence_and_keeps_the_rest() {
        let queues = [queue(&[1]), queue(&[7, 8, 9])];
        let mut out = Vec::new();
        interleave(&queues, 2, &mut out);
        assert_eq!(markers(&out), vec![1, 7, 0, 8]);
        // What wasn't needed yet waits for the next write.
        assert_eq!(queues[1].lock().unwrap().len(), BYTES_PER_FRAME);
    }

    #[test]
    fn drops_the_oldest_audio_past_the_limit() {
        let limit = frames(MAX_QUEUED);
        let queues = [queue(&vec![5; limit + 100])];
        let mut out = Vec::new();
        interleave(&queues, 10, &mut out);
        assert_eq!(queues[0].lock().unwrap().len(), limit * BYTES_PER_FRAME);
    }

    #[test]
    fn reports_each_source_peak() {
        let loud: Vec<u8> = [0.5f32, -0.9, 0.1, 0.2]
            .iter()
            .flat_map(|s| s.to_le_bytes())
            .collect();
        let queues = [
            Arc::new(Mutex::new(loud.into_iter().collect())),
            Queue::default(),
        ];
        let mut out = Vec::new();
        assert_eq!(interleave(&queues, 2, &mut out), vec![0.9, 0.0]);
    }

    #[test]
    fn titles_and_mixes_tracks() {
        let app = AudioSource::App {
            pid: 1,
            name: "VALORANT".into(),
        };
        assert_eq!(app.title(), "VALORANT");
        assert!(!app.in_mix());
        assert!(AudioSource::Desktop.in_mix() && AudioSource::Microphone { device: None }.in_mix());
    }
}
