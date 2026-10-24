import { z } from 'zod';

import { TransferType } from './mega-output';

export const transferSchema = z.object({
  tag: z.string(),
  type: z.enum(TransferType),
  /** The file or folder name, for showing. */
  name: z.string(),
  sourcePath: z.string(),
  destinationPath: z.string(),
  /** A TransferState, or whatever else MEGAcmd printed. */
  state: z.string(),
  /**
   * Unfinished and not paused itself, but held by "pause all" (see parsePausedQueues): it won't
   * move until the queue is resumed, whatever its state says.
   */
  heldByQueue: z.boolean(),
  percent: z.number(),
  totalBytes: z.number().nullable(),
  /** Only while it's moving, and once there are a few polls to go on. */
  bytesPerSecond: z.number().nullable(),
  etaSeconds: z.number().nullable(),
});
export type Transfer = z.infer<typeof transferSchema>;

export const accountSchema = z.object({
  loggedIn: z.boolean(),
  email: z.string().nullable(),
});
export type Account = z.infer<typeof accountSchema>;

export const snapshotSchema = z.object({
  account: accountSchema,
  /** Unfinished ones in queue order, then the most recently finished. */
  transfers: transferSchema.array(),
  /** "Pause all" is on. MEGAcmd only says so while there's a transfer listed. */
  queuePaused: z.boolean(),
  /** Why the last read of MEGAcmd failed, if it did. The rest is then from the read before. */
  error: z.string().nullable(),
  generatedAt: z.iso.datetime(),
});
export type Snapshot = z.infer<typeof snapshotSchema>;

/** A change MEGAcmd refused, with what it said. */
export const errorSchema = z.object({ message: z.string() });

export const StreamEvent = {
  Snapshot: 'snapshot',
  /** Sent between snapshots so idle proxies keep the connection open. */
  Ping: 'ping',
} as const;
