import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { internal } from './_generated/api';

const http = httpRouter();

http.route({
  path: '/topaz/report-status',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const body = (await request.json()) as {
      serviceName?: unknown;
      status?: unknown;
    };

    if (typeof body.serviceName !== 'string' || !body.serviceName) {
      return new Response('Missing serviceName', { status: 400 });
    }

    if (body.status !== 'ok' && body.status !== 'down') {
      return new Response('status must be "ok" or "down"', { status: 400 });
    }

    await ctx.runMutation(internal.sapphire.v1.systemStatuses.updateStatus, {
      serviceName: body.serviceName,
      status: body.status,
    });

    return new Response(null, { status: 204 });
  }),
});

export default http;
