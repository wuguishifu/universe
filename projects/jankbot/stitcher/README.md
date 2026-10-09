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
  3. downloads each utterance's WAV from S3 (utterances/<utteranceId>.wav, uploaded by core)
  4. per phrase, in the order it was said: pads each clip, merges overlaps, fades the edges and joins them with
     a short gap (audio.ts, in JS)
  5. encodes with ffmpeg to Ogg Opus at compilations/<sessionId>/<phrase>.ogg in the same bucket
```

- Clips are as precise as the transcript's segment timings, which are often a whole utterance.
- Utterances missing from S3 (a failed upload in core, or expired by the bucket's lifecycle rule) are skipped. A
  retried job redoes the whole session and overwrites the same files.
- Compilations only go to S3 for now; nothing posts them anywhere.
- ffmpeg isn't in the image: mount the host's binary into the container and point `FFMPEG_PATH` at it. It must run on
  the image's Debian (a static build is safest) and include libopus; the stitcher checks both on startup and won't
  start otherwise.
- The HTTP server only serves `/api/health` and `/api/version`.

## Local development

1. Secrets (see `secretsPaths` in `environment-config.json` and `.env.example`), then `nx setup environment`.
2. ffmpeg on your `PATH` (or set `FFMPEG_PATH`), with libopus.
3. `pnpm nx serve jankbot-stitcher`, on the same `REDIS_URL` as jankbot-gateway and jankbot-core.
