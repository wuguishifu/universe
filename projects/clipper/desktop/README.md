# clipper-desktop

Clipper for Windows: keeps the last two minutes of gameplay and saves them as clips. Each audio
source goes on its own track, plus one mixed, loudness-normalized track. Clips can then be sent
to [clipper-service](../service/README.md) to find the moment worth posting.

Tauri 2: a Rust backend with a Vite + React UI in WebView2.

## Layout

```plaintext
desktop/
  src/                 the UI (Vite + React + Tailwind, @libs/ui-web)
    lib/commands.ts    typed wrappers for the Rust commands
  src-tauri/           the Tauri app crate: window, commands, tray, hotkeys
  crates/capture/      the capture engine, with no Tauri in it, so it can be tested on its own
  Cargo.toml           the Cargo workspace for both crates
```

## Running it

Needs Rust (stable, `x86_64-pc-windows-msvc`) and WebView2, which Windows 11 includes.

```bash
pnpm nx dev clipper-desktop       # tauri dev: Vite on :4212 plus the app, reloading on changes
pnpm nx build clipper-desktop     # tauri build: an NSIS installer in target/release/bundle
pnpm nx test clipper-desktop      # cargo test --workspace
pnpm nx check-rust clipper-desktop
pnpm nx tauri clipper-desktop -- <args>   # any other tauri CLI command
```

## How capture works now (MVP)

`Recorder` (crates/capture/src/recorder.rs) runs ffmpeg from PATH (or `CLIPPER_FFMPEG`):

- **Video:** the source is picked in the app: the main display (`ddagrab`, Desktop Duplication)
  or one window (`gfxcapture`, Windows.Graphics.Capture, by HWND). Either way D3D11 frames go
  straight into `h264_mf`, the GPU's Media Foundation encoder, and never reach the CPU (about 7%
  of one core at 4K60). That's the NVIDIA MFT here; `h264_nvenc` needs driver 610+ with ffmpeg 9.
- **Windows only send frames when they change.** `fps` fills the gaps between frames, but
  nothing is recorded while a window sends none (minimized, or a static app), and no new
  segments are written. Games redraw every frame, so they're fine. A closed window falls back to
  the display. Switching sources starts the buffer over.
- **Audio tracks** (crates/capture/src/audio.rs), one WASAPI capture each:
  - **Desktop**: everything the default output device plays (loopback). Always recorded.
  - **The recorded window's app**, automatically, and any other **apps** added in the app (e.g.
    Discord): process loopback, which takes the process and its children.
  - **Microphone**, when switched on: Windows' default input device, or one picked in the app.
    That choice, and whether it's on, is remembered in `settings.json` in the app's config
    folder; added apps aren't, as they're picked by process.

  Each track has a live level meter in the app.

  They're interleaved into one raw PCM stream on ffmpeg's stdin (2 channels per track), so they
  can't drift apart, and ffmpeg splits it back into a titled AAC track each. A source that's
  quiet, or fails to start, is silence. The audio clock starts when ffmpeg starts reading stdin,
  after it's opened the video source, so audio and video start together (measured within a frame).

- ffmpeg writes 2s MPEG-TS segments to `%LOCALAPPDATA%\com.wuguishifu.clipper\buffer`. Old ones are
  deleted. **Alt+F9** (or the button) joins the newest segments covering 2 minutes (or since
  recording started) into `Videos\Clipper\<window title or "Clipper"> <date> <time>.mp4` and
  beeps.
- **Saved clips** have the video and every track copied as they are, plus a **Mix** first (the
  default track, as most players only play the first). Mix is Desktop + Microphone (apps are
  already in Desktop), measured with EBU R128 and turned toward -16 LUFS, at most +12 dB, then
  limited to -1 dBFS peaks. Tracks are named in MP4 by both `name` and `handler_name`.
- If ffmpeg exits, it's started again after 2s. Clips only come from the current run. Changing
  the source or tracks starts the buffer over.

To try the recorder without the app:

```bash
cargo run -p clipper-capture --example record -- --list                       # windows, audio apps
cargo run -p clipper-capture --example record -- 15 clip.mp4                  # the display
cargo run -p clipper-capture --example record -- 15 clip.mp4 --window VALORANT --app Discord --mic
cargo run -p clipper-capture --example record -- --meter-inputs                # which inputs are live
```

## How capture will work

```plaintext
Windows.Graphics.Capture ─► GPU encoder (NVENC/AMF/QSV) ─► ReplayBuffer (video)
WASAPI process loopback  ─► AAC/Opus per source         ─► ReplayBuffer per source
                                   │
             all stamped with one QPC clock (Timestamp, 100ns ticks)
                                   │
hotkey ─► ReplayBuffer::last(2 min) from each ─► ffmpeg sidecar:
          -map video + each source (titled), amix ─► loudnorm as the last track
```

- **Audio is captured in Rust.** ffmpeg can't capture one app's audio on Windows. Process
  loopback (`ActivateAudioInterfaceAsync` with `AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS`, Windows 10
  2004 or later) can, and an ordinary loopback on the output device gives the whole desktop.
- **Buffers hold encoded packets**, not raw frames, and drop whole GOPs, so a clip always starts
  on a keyframe. Keep the GOP short (1-2s) so clips start close to when they should.
- **Everything shares one clock.** WASAPI and WGC both report QPC times; lining the tracks up
  when a clip is saved depends on it.
- **ffmpeg and ffprobe ship as sidecars** (`bundle.externalBin` in tauri.conf.json, named
  `ffmpeg-x86_64-pc-windows-msvc.exe` in `src-tauri/binaries/`). They aren't added yet: Tauri
  refuses to build when a listed sidecar is missing. Builds with libx264 are GPL.

## Talking to clipper-service

The API calls go from the UI with the ts-rest client for `@projects/clipper-contracts`. Rust
does the work on files: hashing the original, making the proxy with ffmpeg, and PUTting it to
the presigned URL the UI got.
