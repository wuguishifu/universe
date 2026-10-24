import { v } from 'convex/values';

import { internalMutation, query } from '../../_generated/server';

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query('readingList').order('desc').collect();
  },
});

export const addItem = internalMutation({
  args: {
    name: v.string(),
    notes: v.optional(v.string()),
    recommendedBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('readingList', {
      ...args,
    });
  },
});
