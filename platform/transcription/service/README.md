# transcription-service

Media worker service. Other apps own their business logic and hand transcription-service the heavy media
work over HTTP. For now that's speech-to-text with [whisper.cpp](https://github.com/ggml-org/whisper.cpp):
audio in, transcript out.

The contract is `@universe/contracts-transcription-service` (ts-rest). Callers never see transcription-service's queues.

## Architecture

```plaintext
 caller (discord bot, clipper...)
   │  POST /api/transcriptions        short audio, waits for the transcript
   │  POST /api/transcription-jobs    long audio, returns a job ID to poll
   ▼
 ┌─────────────── ROLE=api ───────────────┐
 │ validate → add job to the lane's queue │
 │ sync: wait for completion (≤60s)       │
 └───────────────────┬────────────────────┘
                     │ Redis (BullMQ, prefix `transcription-service-queue`)
        ┌────────────┴─────────────┐
        ▼                          ▼
  transcription-interactive   transcription-batch
        │                          │
 ┌──────┴──────── ROLE=worker ─────┴──────┐
 │ source → ffmpeg (16kHz mono WAV)       │
 │        → whisper-cli --output-json     │
 │        → { text, segments, … }         │
 └────────────────────────────────────────┘
```

**One image, three roles** (`TRANSCRIPTION_SERVICE_ROLE`):

| Role     | Runs                   | Deploy as                                      |
| -------- | ---------------------- | ---------------------------------------------- |
| `api`    | HTTP routes, adds jobs | Small Deployment with a Service                |
| `worker` | whisper for its lanes  | Deployment with CPU limits and a models volume |
| `all`    | both                   | Local development                              |

The worker only needs to reach Redis, not accept connections. So a worker can run anywhere
that can reach Redis: in the cluster, natively on a Mac over Tailscale (Metal-accelerated
whisper.cpp), or on a GPU node, without callers noticing.

**Two lanes, each its own queue and worker.** BullMQ priorities only reorder _waiting_ jobs;
a running 20-minute batch job would still block a 2-second clip. Separate queues with their
own workers and thread budgets (`WHISPER_THREADS_*`) keep interactive latency independent of
batch load. `TRANSCRIPTION_SERVICE_WORKER_LANES` picks which lanes a worker process takes.

## API

All routes except `/api/health` and `/api/version` need `Authorization: Bearer <TRANSCRIPTION_SERVICE_API_TOKEN>`.

| Route                                | Lane        | Response                                        |
| ------------------------------------ | ----------- | ----------------------------------------------- |
| `POST /api/transcriptions`           | interactive | `200` transcript · `400` · `422` failed · `504` |
| `POST /api/transcription-jobs`       | batch       | `202 { jobId }` · `400`                         |
| `GET /api/transcription-jobs/:jobId` | batch       | `200 { status, transcript? , error? }` · `404`  |
| `GET /api/models`                    |             | `200 { defaultModel, models, vadAvailable }`    |

Request body (both POSTs):

```jsonc
{
  "source": { "type": "inline", "data": "<base64, ≤10MB, any ffmpeg format>" },
  //     or { "type": "s3", "bucket": "…", "key": "…" }  (transcription-service reads with its own key)
  "options": { "model": "base.en", "language": "en", "prompt": "…", "vad": false },
}
```

### Retries and idempotency

Send an `Idempotency-Key` header (unique across callers, e.g. `discord-bot:<job id>`).
Repeating a request with the same key attaches to the original job instead of transcribing
again:

- **504 from `/transcriptions`**: the job is still queued or running. Retry with the same key
  to pick up the result when it's done.
- **Lost response**: same. A completed job is kept for 5 minutes (interactive) or 1 hour (batch).
- **Failed job**: a retry with the same key runs it again.

`422` means the audio couldn't be decoded or transcribed; retrying won't help. `transcription-service` doesn't
retry interactive jobs itself (the waiting caller decides). Batch jobs retry 3 times with
backoff, except for permanent failures such as undecodable audio or a missing S3 object.

## Configuration

See [`.env.example`](./.env.example). Models are `ggml-<name>.bin` files in `WHISPER_MODELS_DIR`
([downloads](https://huggingface.co/ggerganov/whisper.cpp/tree/main)). `WHISPER_MODELS` is the
allow-list callers can request; keep it identical on API and worker pods. Setting
`WHISPER_VAD_MODEL_PATH` to a Silero VAD model enables the `vad` option.

## Performance notes

Whisper's encoder always processes a 30-second window, so a 2-second clip costs almost as much
as 30 seconds of audio; on CPU the encoder is most of the time for short clips. What helps
(benchmarked on the homelab's Intel N100, Sep 2026):

- **`q8_0` quantized models** (e.g. `base.en-q8_0`): ~2x faster than the f16 originals with
  identical transcripts. `q5_1` was slower than `q8_0` and less accurate.
- **Greedy decoding** (`WHISPER_BEAM_SIZE_*=1`): 10–35% faster, more so on longer clips.
- **More threads**: 3 vs 2 threads was ~25% faster.

What doesn't: whisper-cli's `--audio-ctx`, which shrinks the 30-second window. It made very short
clips up to 4x faster but produced repeated sentences (a 7.6s clip with 2s of headroom repeated
its last sentence three times), which would corrupt phrase counts. Don't use it.

## Local development

Nx loads two env files for `nx serve transcription-service` (`.env.local` wins where both set a variable):

- `.env.local`: secrets (token, Redis, S3) generated from Infisical `/transcription-service` by
  `nx setup environment`. Don't edit it.
- root `.env`: settings specific to your machine, mainly where whisper lives. For example, reusing
  a native whisper.cpp build and model:

  ```sh
  WHISPER_CLI_PATH=/path/to/whisper-cli
  WHISPER_MODELS_DIR=/path/to/models   # contains ggml-base.en.bin
  WHISPER_MODELS=base.en
  ```

```sh
pnpm nx serve transcription-service   # TUNGSTEN_ROLE defaults to `all`
```

## Deployment notes

- Docker builds whisper.cpp from source (`WHISPER_CPP_VERSION` build arg), so the image
  never depends on a binary built elsewhere. It's a CPU build; a GPU worker needs a
  CUDA-enabled build of the same stage.
- In the homelab, run two Deployments from the one image: `transcription-service` (`api`, with a
  ClusterIP Service) and `transcription-service-worker` (`worker`, no Service, CPU requests/limits, models
  PVC). Keep the worker's `terminationGracePeriodSeconds` longer than your longest expected job:
  on SIGTERM it finishes the job it's running before exiting.
- Every transcription logs its realtime factor (processing time ÷ audio length), which is
  the number to watch when choosing models or hardware.
