# ffmpeg-client-nest

Queues ffmpeg jobs on the [ffmpeg worker](../worker) from other NestJS apps, as
[BullMQ flows](https://docs.bullmq.io/guide/flows): the job runs as a child on the worker (natively
on the Mac mini, so VideoToolbox encoders like `h264_videotoolbox` are there), and a job in your
app's own queue (the parent) runs once it's done.

It's for work worth the trip through S3, mostly encoding video. Stream copies, cuts and audio that
are quick on any CPU are usually better done where the files already are.

## Setup

The client reuses your app's `BullRootModule` for its Redis connection, so register that first.
Flows only work when every queue in them is on the same Redis.

```ts
@Module({
  imports: [
    BullRootModule.forRootAsync({ ... }),
    FfmpegClientModule.forRoot(),
  ],
})
export class AppModule {}
```

## Usage

A job is the ffmpeg command, with files as placeholders: the worker downloads `inputs` from S3,
runs `steps` in order in one work dir, and uploads `outputs` once they've all succeeded.

```ts
await this.ffmpeg.addFlow({
  idempotencyKey: clipId,
  request: {
    inputs: { clip: { type: 's3', bucket, key: `proxies/${clipId}.mp4` } },
    outputs: { trimmed: { type: 's3', bucket, key: `clips/${clipId}.mp4` } },
    steps: [
      {
        // prettier-ignore
        args: ['-ss', '12.5', '-to', '41', '-i', '{{ in:clip }}', '-c:v', 'h264_videotoolbox', '-b:v', '6M', '-c:a', 'aac', '-movflags', '+faststart', '{{ out:trimmed }}'],
        expectedDurationMs: 28_500,
      },
    ],
  },
  parent: { queueConfig: MY_QUEUE_CONFIG, queueKey: 'publish', data: { clipId } },
});
```

Read the outputs in the parent's processor:

```ts
override async process(job: MyQueueJob<'publish'>) {
  const { outputs } = await this.ffmpeg.getResult(job);
  outputs.trimmed; // { bucket, key, contentType, sizeBytes, probe: { durationMs, streams, ... } }
}
```

### Placeholders

| Placeholder      | File                                                                        |
| ---------------- | --------------------------------------------------------------------------- |
| `{{ in:name }}`  | `inputs.name`, downloaded as `in/name.<ext>` (the S3 key's extension)       |
| `{{ out:name }}` | `outputs.name`, written to `out/name.<ext>` and uploaded at the end         |
| `{{ tmp:name }}` | A scratch file every step sees, e.g. a two-pass log or an intermediate file |

- `{{in:name}}` works too.
- Placeholders are replaced inside args as well as whole ones, e.g. `-vf subtitles={{ in:subs }}`.
- Names can have letters, digits, `_`, `-` and `.`, but not a `.` first.
- Jobs are checked when they're added. Any other `{{ }}`, an undeclared name, an input no step reads, or an output no step writes is an error.

Every step gets `-hide_banner -nostdin -y` first; the rest of the args are yours. Steps only pass
files to each other: anything that needs one step's output to decide the next one's args belongs in
your code, as two jobs.

### Progress and logs

Jobs report progress (0-100) and log each step's command and result, both visible in Bull Board.
Progress within a step goes by `expectedDurationMs`, or else the longest input the step reads, which
overshoots for a trim.

### When a job fails

- **Fails right away:** a missing input, ffmpeg exiting with an error (the error has the end of its stderr), or the job's `timeoutMs` running out (10 minutes by default, 2 hours at most).
- **Retried 3 times with exponential backoff:** S3 and network errors, the worker restarting, and VideoToolbox failing to create an encoder session.

What happens to the parent after that is up to `jobOptions.onFailure`:

| `onFailure`             | Parent                                               |
| ----------------------- | ---------------------------------------------------- |
| `fail-parent` (default) | Fails without running.                               |
| `run-parent`            | Runs anyway; `getResult` throws `FfmpegFailedError`. |

### Custom flows

To chain services, build the job with `child()` and add the flow with `FlowClient` (from
`@libs/queue`). For example, take the audio out of a video and transcribe it:

```ts
await this.flows.addFlow({
  idempotencyKey: clipId,
  parent: { queueConfig: MY_QUEUE_CONFIG, queueKey: 'publish', data },
  children: [
    this.transcription.child(
      { source: { type: 's3', bucket, key: audioKey } },
      { children: [this.ffmpeg.child(extractAudio)] }, // writes audioKey first
    ),
  ],
});
```

A parent only reads its direct children's results, so here it gets the transcript but not the
ffmpeg result.

### Many flows at once

To queue a backlog (e.g. one job per file), add the flows in chunks of a few hundred with
`FlowClient.addFlows`, which adds each chunk in one round trip to Redis:

```ts
await this.flows.addFlows(
  items.map((item) => ({
    idempotencyKey: item.id,
    parent: { queueConfig: MY_QUEUE_CONFIG, queueKey: 'thumbnail', data: { itemId: item.id } },
    children: [this.ffmpeg.child(thumbnailRequest(item), { priority: 1 })],
  })),
);
```

## The worker's ffmpeg

Homebrew's `ffmpeg` is a slim build: it has VideoToolbox, but no `libwebp`, `zscale` or
`libplacebo`. Jobs that need those want `ffmpeg-full` (keg-only, so point the worker at it):

```sh
FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg
FFPROBE_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffprobe
FFMPEG_REQUIRED_ENCODERS=h264_videotoolbox,hevc_videotoolbox,libwebp
FFMPEG_REQUIRED_FILTERS=zscale,tonemap
```

The worker checks `FFMPEG_REQUIRED_ENCODERS` and `FFMPEG_REQUIRED_FILTERS` on start, so a wrong
ffmpeg fails there rather than in every job.
