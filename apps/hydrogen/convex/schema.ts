import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  readingList: defineTable({
    name: v.string(),
    createdAt: v.number(),
    notes: v.optional(v.string()),
    recommendedBy: v.optional(v.string()),
  }),
});
