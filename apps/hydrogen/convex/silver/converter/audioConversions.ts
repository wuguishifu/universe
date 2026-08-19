import { v } from 'convex/values';
import { mutation } from '../../_generated/server';
import { status } from '../tables';

export const upsertRecord = mutation({
  args: {
    youtubeId: v.string(),
    s3Key: v.string(),
  },
  handler: async (ctx, { youtubeId, s3Key }) => {
    const existingRecord = await ctx.db
      .query('convertedAudioFiles')
      .withIndex('by_youtubeId', (q) => q.eq('youtubeId', youtubeId))
      .first();

    if (existingRecord) {
      await ctx.db.patch('convertedAudioFiles', existingRecord._id, { s3Key });
      return;
    }

    await ctx.db.insert('convertedAudioFiles', {
      youtubeId,
      s3Key,
      status: 'queued',
    });
  },
});

export const updateStatus = mutation({
  args: {
    youtubeId: v.string(),
    status,
    statusDescription: v.optional(v.string()),
  },
  handler: async (ctx, { youtubeId, status, statusDescription }) => {
    const existingRecord = await ctx.db
      .query('convertedAudioFiles')
      .withIndex('by_youtubeId', (q) => q.eq('youtubeId', youtubeId))
      .first();

    if (!existingRecord) return;

    await ctx.db.patch('convertedAudioFiles', existingRecord._id, {
      status,
      statusDescription,
    });
  },
});
