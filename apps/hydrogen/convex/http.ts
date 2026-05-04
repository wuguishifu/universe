import { httpRouter } from 'convex/server';
import { reportStatusesHandler } from './sapphire/v1/systemStatuses';

const http = httpRouter();

http.route({
  path: '/topaz/report-status',
  method: 'POST',
  handler: reportStatusesHandler,
});

export default http;
