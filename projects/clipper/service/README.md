# clipper-service

Finds the part of a Medal clip worth posting. Clips are 1-2 minutes of gameplay saved after
something happens; clipper sends each one to Gemini and gets back where the moment is (start and
end, in seconds), a title, a category, a confidence and why. Trimming is left to the client.

## How it works

```plaintext
Windows client / tools/scripts/media
  1. ffmpeg: original ─► proxy (480p, 4fps, mono AAC, same timeline; ~4MB for 2 min)
  2. POST /api/clips/upload-urls ─► PUT the proxy to s3://clipper/proxies/<sha256 of original>.mp4
  3. POST /api/runs (options + up to 500 clips), then POST /api/runs/:id/clips for more
     │
     ▼  clipper-service: RunsService
        api.clipper.runs.create / addClips (convex): a clip job per clip
        BullMQ "analyze" queue (job ID = clip job ID; 'auto' runs go first)
     │
     ▼  clipper-service: AnalyzeClipProcessor (6 at once)
        1. api.clipper.clipJobs.start: skip if the run was cancelled; wait for tomorrow if today's
           spend is over CLIPPER_DAILY_SPEND_LIMIT_USD; otherwise the clip and the run's options
        2. download the proxy; ffmpeg cuts it to the last `tailSeconds` and/or to audio only
        3. Gemini (inline, structured output); an invalid answer is asked for once more
        4. api.clipper.clipJobs.complete: outcome, tokens and cost on the clip job and run
     │
     ▼  client subscribes to api.clipper.runs.get / clipJobs.listByRun (convex) for results
```

- **Convex** holds the current state: clips (by the original's SHA-256), runs (options, counts,
  spend) and clip jobs (outcome, tokens, cost). Every function takes `CLIPPER_CONVEX_SECRET`.
- **Analytics** (`clipper_job-completed`, `clipper_job-failed`, `clipper_run-created`,
  `clipper_run-finished`, `clipper_spend_cap-hit`) keep the history for comparing cost and results
  over time.
- A run's options are stored with every default filled in, plus the prompt version
  (`PROMPT_VERSION` in [prompt.ts](src/modules/analysis/prompt.ts)), so runs can be compared.
  `POST /api/runs/:id/rerun` runs the same clips with other options.
- Each clip is analyzed once per run; adding it again is a no-op, so requests are safe to retry.
- Errors that won't get better (a missing proxy, an unreadable file, a blocked or twice-invalid
  answer) fail the clip job right away. Others (rate limits, outages) retry 5 times with backoff.

## Run options

All optional; see `runOptionsSchema` in [the contracts](../contracts/src/lib/options.ts).

| option            | default            |                                                                      |
| ----------------- | ------------------ | -------------------------------------------------------------------- |
| `model`           | `gemini-3.8-flash` | any model in `MODEL_PRICING`, so cost is always known                |
| `media`           | `video`            | `audio` sends only the soundtrack (game + mic + Discord)             |
| `mediaResolution` | `low`              | video only; ~66 tokens a frame at low, 258 at medium and high        |
| `fps`             | `1`                | video only; up to 4 (the proxy's rate)                               |
| `tailSeconds`     | whole clip         | only the last N seconds; timestamps still come back on the full clip |
| `thinkingLevel`   | `low`              | `minimal` to `high`; thinking tokens are billed as output            |
| `instructions`    | none               | added to the prompt, for tuning what counts as a good moment         |

A 2-minute clip at the defaults is about 12k input tokens and 1-2k output, so around $0.015 on
`gemini-3.8-flash` (whose price doubles on 2027-01-01). Audio only is about a third of that, and
`tailSeconds: 45` cuts it by about 60%.

## Setup

1. Secrets in Infisical at `projects/clipper/service`: `API_TOKEN`, `CLIPPER_CONVEX_SECRET` (plus
   the shared Gemini, S3, Redis and analytics paths; see
   [environment-config.json](environment-config.json) and [.env.example](.env.example)).
   `CONVEX_URL` comes from the dev deployment locally (`hasConvex`), and from
   `platform/convex/app` in prod.
2. The same secret on the convex deployment:
   `pnpm nx convex convex-app -- env set CLIPPER_CONVEX_SECRET <value>`.
3. A Garage bucket `clipper` (or `CLIPPER_S3_BUCKET`) that clipper's S3 key can read and write.
4. ffmpeg with libx264 and aac at `FFMPEG_PATH` (mounted from the host in k8s, like the stitcher's).
   It's checked on startup.

It runs on sol, in the homelab repo's `manifests/clipper-service` (with a tailnet Ingress at
`https://clipper.wuguishifu.dev`); its README has the prod checklist.

## The backlog

See [tools/scripts/media](../../../tools/scripts/media/README.md): make proxies from the drive,
then upload them and start a run, e.g. a 200-clip sample per set of options to compare first.
