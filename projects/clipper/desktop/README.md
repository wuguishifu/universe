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

- **Video:** `ddagrab` (Desktop Duplication of the main display) feeds D3D11 frames straight
  into `h264_mf`, the GPU's Media Foundation encoder. That's the NVIDIA MFT here; `h264_nvenc`
  needs driver 610+ with ffmpeg 9.
- **Audio:** WASAPI loopback of the default output device (crates/capture/src/audio.rs), piped
  in as raw PCM. Silence is written while nothing plays, so the audio stays in step with the clock.
- ffmpeg writes 2s MPEG-TS segments to `%LOCALAPPDATA%\com.wuguishifu.clipper\buffer`. Old ones are
  deleted. **Alt+F9** (or the button) joins the newest segments covering 2 minutes (or since
  recording started) into `Videos\Clipper\Clipper <date> <time>.mp4` and beeps.
- If ffmpeg exits, it's started again after 2s. Clips only come from the current run.

To try the recorder without the app:

```bash
cargo run -p clipper-capture --example record -- 15 clip.mp4
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
