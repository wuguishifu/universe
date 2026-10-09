# jankbot-stitcher

Compiles every time someone said a tracked phrase during a voice session into one audio file per phrase.

```plaintext
gateway: VoiceSessionService
  a session ends (/leave, kicked, idle timeout, /join elsewhere, nobody left after a restart)
  │
  ▼  BullMQ "stitch-sessions" queue (sessionId, delayed 30s, job ID = sessionId)
stitcher: StitchSessionProcessor
  1. waits while any of the session's utterances are still in core's queues or being transcribed
     (re-checks every minute, up to STITCH_MAX_WAIT_MS after the session ended)
  2. reads the session's rows from jankbot.recordings (written by core's TranscribedUtteranceProcessor)
  3. per phrase, in the order it was said, a few recordings ahead:
     a. reads just the part of the utterance's WAV around its clips (an S3 ranged read of
        utterances/<utteranceId>.wav, uploaded by core)
     b. snaps each clip's edges to the speech around it, merges overlaps, evens out the loudness and fades the
        edges (audio.ts, in JS)
     c. appends it to a PCM file on disk, with a short gap between clips
  4. encodes that file with ffmpeg to Ogg Opus, and streams it to compilations/<sessionId>/<phrase>.ogg in the same
     bucket
```

- Clips come from whisper's word timings, so they're just the phrase. Recordings from before the transcription worker
  emitted words have segment timings instead, which are often the whole utterance.
- Utterances missing from S3 (a failed upload in core, or expired by the bucket's lifecycle rule) are skipped. A
  retried job redoes the whole session and overwrites the same files.
- Memory doesn't grow with the session: only a few recordings' audio (each at most an utterance, ~1MB) is held at
  once, and compilations are built on disk. A 6,000-recording test session peaked at ~200MB RSS; disk needs about
  115MB per hour of compiled audio, while that phrase is being encoded.
- Compilations only go to S3 for now; nothing posts them anywhere.
- ffmpeg isn't in the image: mount the host's binary into the container and point `FFMPEG_PATH` at it. It must run on
  the image's Debian (a static build is safest) and include libopus; the stitcher checks both on startup and won't
  start otherwise.
- The HTTP server only serves `/api/health` and `/api/version`.

## Local development

1. Secrets (see `secretsPaths` in `environment-config.json` and `.env.example`), then `nx setup environment`.
2. ffmpeg on your `PATH` (or set `FFMPEG_PATH`), with libopus.
3. `pnpm nx serve jankbot-stitcher`, on the same `REDIS_URL` as jankbot-gateway and jankbot-core.
