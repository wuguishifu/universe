# transcription-client-nest

Queues transcriptions on the [transcription worker](../worker) from other NestJS apps, as
[BullMQ flows](https://docs.bullmq.io/guide/flows): the transcription runs as a child job on the
worker, and a job in your app's own queue (the parent) runs once it's done.

## Setup

The client reuses your app's `BullRootModule` for its Redis connection, so register that first.
Flows only work when every queue in them is on the same Redis.

```ts
@Module({
  imports: [
    BullRootModule.forRootAsync({ ... }),
    TranscriptionClientModule.forRoot(),
  ],
})
export class AppModule {}
```

## Usage

Queue one or more transcriptions with a parent job. The parent runs once every transcription is
done, and is typed by your queue config, so `data` is checked against that queue's `jobSchema` at
compile time and again at runtime.

Each transcription is keyed by a name of your choosing, e.g. a speaker's ID when a recording has a
track per speaker. Each one runs as its own job on the worker.

```ts
await this.transcription.addFlow({
  requests: {
    [aliceId]: {
      source: { type: 's3', bucket, key: aliceTrack }, // or { type: 'inline', data: base64 } for short clips
      options: { prompt }, // also model, beamSize, and wordTimestamps for transcript.words
    },
    [bobId]: { source: { type: 's3', bucket, key: bobTrack } },
  },
  parent: {
    queueKey: 'wordDetection',
    data: { guildId, recordingId },
  },
});
```

`addFlows` takes an array of the same and adds them all at once.

Read the transcripts in the parent's processor, one at a time by key or all at once:

```ts
override async process(job: MyQueueJob<'wordDetection'>) {
  const { transcript } = await this.transcription.getResult(job, aliceId);

  // Keyed like `requests`, shaped like Promise.allSettled's results.
  const outcomes = await this.transcription.getResults(job);
}
```

Keys can't contain `:`.

### Retries and idempotency

Pass an `idempotencyKey` (e.g. the ID of whatever you're transcribing) when the code adding the
flow can run more than once, like a job that retries. Adding a flow with the same key again is a
no-op while its jobs are still in Redis. It becomes the parent's ID and prefixes the
transcriptions' IDs (`<idempotencyKey>.<key>`), so it can't contain `:`.

A retried parent job doesn't transcribe again either: `getResult` reads the results stored on the
parent.

### When transcription fails

Undecodable audio fails right away; other errors retry 3 times with exponential backoff. What
happens to the parent after that is up to `jobOptions.onFailure`, which applies to every
transcription in the flow:

| `onFailure`             | Parent                                                                                                                           |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `fail-parent` (default) | Fails without running as soon as any transcription fails.                                                                        |
| `run-parent`            | Runs once the rest finish; `getResult` throws `TranscriptionFailedError` for a failed one, and `getResults` marks it `rejected`. |

`jobOptions` also takes `attempts`, `backoff`, `priority`, `removeOnComplete` and `removeOnFail` for
the transcription jobs. These have to be set here rather than on the worker: in a flow, job options
come from whoever adds the job.

### Custom flows

For a parent with other children too, build the flow with `buildFlow()` and add it yourself. Keep
the parent's `opts.jobId`: `getResults` finds the transcriptions by it.

```ts
const flow = this.transcription.buildFlow({ requests, parent });
await flowProducer.add({ ...flow, children: [...flow.children, otherChild] });
```
