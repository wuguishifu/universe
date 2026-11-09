//! Desktop audio: a WASAPI loopback capture of the default output device, written out as one
//! continuous stream of raw PCM.

use std::collections::VecDeque;
use std::io::Write;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use wasapi::{DeviceEnumerator, Direction, SampleType, StreamMode, WaveFormat};

pub const SAMPLE_RATE: u32 = 48_000;
pub const CHANNELS: u16 = 2;
/// 32-bit float samples, as ffmpeg's `f32le`.
const BYTES_PER_FRAME: usize = 4 * CHANNELS as usize;

/// How far the stream may fall behind the clock before silence is written to catch up.
const MAX_BEHIND: Duration = Duration::from_millis(100);
/// How far the stream may run ahead of the clock before captured audio is dropped.
const MAX_AHEAD: Duration = Duration::from_millis(200);
const POLL: Duration = Duration::from_millis(10);

fn frames(duration: Duration) -> u64 {
    (duration.as_secs_f64() * f64::from(SAMPLE_RATE)) as u64
}

/// Captures what the default output device plays and writes it to `out` as interleaved
/// `f32le` stereo at [`SAMPLE_RATE`], until `stop` is set or a write fails.
///
/// Loopback delivers nothing while nothing plays, so silence is written to keep the stream at
/// real time: one second of output is always one second on the clock, which keeps it in step
/// with the video it's muxed with.
pub fn capture_loopback(mut out: impl Write, stop: Arc<AtomicBool>) -> Result<(), String> {
    let hr = wasapi::initialize_mta();
    if hr.is_err() {
        return Err(format!("couldn't initialize COM: {hr:?}"));
    }
    let err = |what: &str| {
        let what = what.to_owned();
        move |e: wasapi::WasapiError| format!("{what}: {e}")
    };

    let device = DeviceEnumerator::new()
        .map_err(err("couldn't list audio devices"))?
        .get_default_device(Direction::Render)
        .map_err(err("couldn't find the default output device"))?;
    let name = device.get_friendlyname().unwrap_or_default();
    let mut client = device
        .get_iaudioclient()
        .map_err(err("couldn't open the output device"))?;
    let format = WaveFormat::new(
        32,
        32,
        SampleType::Float,
        SAMPLE_RATE as usize,
        CHANNELS as usize,
        None,
    );
    // Capturing from a render device is loopback. Polled, as loopback doesn't signal events on
    // older Windows builds; a 1s buffer leaves room for a slow write.
    client
        .initialize_client(
            &format,
            Direction::Capture,
            StreamMode::PollingShared {
                autoconvert: true,
                buffer_duration_hns: 10_000_000,
            },
            None,
        )
        .map_err(err("couldn't start loopback capture"))?;
    let capture = client
        .get_audiocaptureclient()
        .map_err(err("couldn't start loopback capture"))?;
    client
        .start_stream()
        .map_err(err("couldn't start loopback capture"))?;
    tracing::info!(device = %name, "capturing desktop audio");

    let start = Instant::now();
    let mut written: u64 = 0;
    let mut queue: VecDeque<u8> = VecDeque::new();
    let silence = vec![0u8; frames(Duration::from_millis(500)) as usize * BYTES_PER_FRAME];

    let result = (|| {
        while !stop.load(Ordering::Relaxed) {
            while capture
                .get_next_packet_size()
                .map_err(err("couldn't read desktop audio"))?
                .unwrap_or(0)
                > 0
            {
                capture
                    .read_from_device_to_deque(&mut queue)
                    .map_err(err("couldn't read desktop audio"))?;
            }

            let expected = frames(start.elapsed());
            let available = (queue.len() / BYTES_PER_FRAME) as u64;
            let room = (expected + frames(MAX_AHEAD)).saturating_sub(written);
            let take = available.min(room);
            if take > 0 {
                let bytes = take as usize * BYTES_PER_FRAME;
                let (a, b) = queue.as_slices();
                let a_len = a.len().min(bytes);
                out.write_all(&a[..a_len]).map_err(|e| e.to_string())?;
                out.write_all(&b[..bytes - a_len])
                    .map_err(|e| e.to_string())?;
                queue.drain(..bytes);
                written += take;
            }
            // Audio arriving faster than the clock (drift between clocks) is dropped.
            if (queue.len() / BYTES_PER_FRAME) as u64 > frames(MAX_AHEAD) {
                queue.clear();
            }

            let mut behind = expected.saturating_sub(written);
            if behind > frames(MAX_BEHIND) {
                while behind > 0 {
                    let n = (behind as usize * BYTES_PER_FRAME).min(silence.len());
                    out.write_all(&silence[..n]).map_err(|e| e.to_string())?;
                    behind -= (n / BYTES_PER_FRAME) as u64;
                    written += (n / BYTES_PER_FRAME) as u64;
                }
            }
            out.flush().map_err(|e| e.to_string())?;
            thread::sleep(POLL);
        }
        Ok(())
    })();

    let _ = client.stop_stream();
    result
}
