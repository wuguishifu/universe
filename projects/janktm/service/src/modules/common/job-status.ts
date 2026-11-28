import { type Job } from 'bullmq';

/** A job's state for the API: what Bull Board shows, minus the internals. */
export async function jobStatus(job: Job) {
  return {
    id: job.id,
    state: await job.getState(),
    data: job.data,
    progress: job.progress,
    result: job.returnvalue ?? null,
    failedReason: job.failedReason ?? null,
    attemptsMade: job.attemptsMade,
    createdAt: job.timestamp,
    startedAt: job.processedOn ?? null,
    finishedAt: job.finishedOn ?? null,
  };
}
