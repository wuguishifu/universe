import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export const systemStatus = v.union(v.literal('ok'), v.literal('down'));

export default defineSchema({
  readingList: defineTable({
    name: v.string(),
    notes: v.optional(v.string()),
    recommendedBy: v.optional(v.string()),
  }),
  systemStatuses: defineTable({
    status: systemStatus,
    serviceName: v.string(),
  }).index('serviceName', ['serviceName']),
});
