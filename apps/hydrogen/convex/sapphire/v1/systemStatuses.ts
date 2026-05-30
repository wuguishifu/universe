import { v } from 'convex/values';
import { z } from 'zod';

import { internal } from '../../_generated/api';
import { internalMutation, query } from '../../_generated/server';
import { httpPostAction } from '../../common/functions/customFunctions';
import { systemStatus } from '../../schema';

export const list = query({
  args: {},
  handler: async (ctx) => {
    const statuses = await ctx.db.query('systemStatuses').collect();
    const downCount = statuses.reduce(
      (acc, curr) => (curr.status === 'down' ? acc + 1 : acc),
      0,
    );

    return {
      statuses,
      status:
        downCount === 0
          ? 'ok'
          : downCount === statuses.length
            ? 'down'
            : 'degraded',
    };
  },
});

export const updateStatus = internalMutation({
  args: {
    serviceName: v.string(),
    status: systemStatus,
  },
  handler: async (ctx, args) => {
    const service = await ctx.db
      .query('systemStatuses')
      .withIndex('serviceName', (q) => q.eq('serviceName', args.serviceName))
      .unique();

    if (service) {
      await ctx.db.patch(service._id, { status: args.status });
    } else {
      await ctx.db.insert('systemStatuses', args);
    }
  },
});

const statusReportBody = z.object({
  serviceName: z.string(),
  status: z.enum(['ok', 'down']),
});

export const reportStatusesHandler = httpPostAction({
  bodySchema: statusReportBody,
  handler: async ({ ctx, body }) => {
    await ctx.runMutation(internal.sapphire.v1.systemStatuses.updateStatus, {
      serviceName: body.serviceName,
      status: body.status,
    });
    return new Response(null, { status: 204 });
  },
});
