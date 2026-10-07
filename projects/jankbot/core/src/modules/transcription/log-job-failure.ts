import { type Logger } from '@nestjs/common';
import { type Job, UnrecoverableError } from 'bullmq';

/** BullMQ swallows processing errors (it just retries, then marks the job failed), so log them. */
export function logJobFailure(
  logger: Logger,
  job: Job<{ guildId: string; userId: string }> | undefined,
  error: Error,
) {
  // Some errors (e.g. fetch's "fetch failed") hide the real reason in `cause`.
  const reason =
    error.cause instanceof Error
      ? `${error.message}: ${error.cause.message}`
      : error.message;
  if (!job) {
    logger.error(`Job failed: ${reason}`);
    return;
  }
  const { guildId, userId } = job.data;
  const attempts = job.opts.attempts ?? 1;
  const final =
    error instanceof UnrecoverableError || job.attemptsMade >= attempts;
  const message = `[${guildId}] ${userId}: attempt ${job.attemptsMade}/${attempts} failed: ${reason}`;
  if (final) {
    logger.error(`${message} (giving up)`);
  } else {
    logger.warn(`${message} (will retry)`);
  }
}
