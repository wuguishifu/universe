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

Queue a transcription with a parent job. The parent is typed by your queue config, so `data` is
checked against that queue's `jobSchema` at compile time and again at runtime.

```ts
await this.transcription.addFlow({
  request: {
    source: { type: 's3', bucket, key }, // or { type: 'inline', data: base64 } for short clips
    options: { prompt },
  },
  parent: {
    queueConfig: MY_QUEUE_CONFIG,
    queueKey: 'wordDetection',
    data: { guildId, userId },
  },
});
```

Read the transcript in the parent's processor:

```ts
override async process(job: MyQueueJob<'wordDetection'>) {
  const { transcript } = await this.transcription.getResult(job);
}
```

### When transcription fails

Undecodable audio fails right away; other errors retry 3 times with exponential backoff. What
happens to the parent after that is up to `jobOptions.onFailure`:

| `onFailure`             | Parent                                                      |
| ----------------------- | ----------------------------------------------------------- |
| `fail-parent` (default) | Fails without running.                                      |
| `run-parent`            | Runs anyway; `getResult` throws `TranscriptionFailedError`. |

`jobOptions` also takes `attempts`, `backoff`, `priority`, `removeOnComplete`, `removeOnFail` and
`jobId` for the transcription job. These have to be set here rather than on the worker: in a
flow, job options come from whoever adds the job.

### Custom flows

For a parent with other children too, build the transcription job with `child()` and add the flow
yourself. A parent can have at most one transcription child.

```ts
await flowProducer.add({
  ...parent,
  children: [this.transcription.child(request), otherChild],
});
```
