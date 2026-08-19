import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const status = v.union(
  v.literal('queued'),
  v.literal('processing'),
  v.literal('completed'),
  v.literal('failed'),
);

export const silverTables = {
  convertedAudioFiles: defineTable({
    youtubeId: v.string(),
    status,
    statusDescription: v.optional(v.string()),
    s3Key: v.string(),
    completedAt: v.optional(v.number()),
  })
    .index('by_youtubeId', ['youtubeId'])
    .index('by_completedAt', ['completedAt']),
} as const;
