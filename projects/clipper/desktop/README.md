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
