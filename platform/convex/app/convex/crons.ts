import { cronJobs } from 'convex/server';

import { internal } from './_generated/api';

const crons = cronJobs();

crons.interval(
  'fail stuck clipper clip jobs',
  { minutes: 5 },
  internal.clipper.clipJobs.failStuck,
);

export default crons;
