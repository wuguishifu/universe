import { z } from 'zod';
import { clipInputSchema, MAX_CLIPS_PER_REQUEST } from '../clips';
import { c } from '../contract';
import { runOptionsSchema, runSourceSchema } from '../options';
import { clipJobSchema, clipJobStateSchema, runSchema } from '../runs';

const errorSchema = z.object({ message: z.string() });
const clipsSchema = clipInputSchema.array().min(1).max(MAX_CLIPS_PER_REQUEST);
const runParams = z.object({ runId: z.string().min(1) });
const queuedSchema = z.object({
  /** Clip jobs added to the queue by this request. */
  queued: z.number(),
  /** Clips that were already in the run (each clip is analyzed once per run). */
  alreadyInRun: z.number(),
});

/**
 * Runs are written here and read from Convex (api.clipper.runs, api.clipper.clipJobs), which the
 * client can subscribe to for progress and results. get and clipJobs are the same reads for
 * scripts, which don't have the Convex secret.
 */
export const runsRouter = c.router(
  {
    create: {
      method: 'POST',
      path: '',
      description:
        'Start a run: analyze these clips with these options. Add more with addClips.',
      body: z.object({
        options: runOptionsSchema.optional(),
        source: runSourceSchema.default('manual'),
        /** Shown in the client, e.g. "audio only, last 45s". */
        label: z.string().trim().min(1).max(200).optional(),
        clips: clipsSchema,
      }),
      responses: {
        201: queuedSchema.extend({ runId: z.string() }),
      },
    },
    addClips: {
      method: 'POST',
      path: '/:runId/clips',
      description:
        "Add clips to a run. Clips already in it are skipped, so it's safe to retry.",
      pathParams: runParams,
      body: z.object({ clips: clipsSchema }),
      responses: {
        200: queuedSchema,
        404: errorSchema,
        409: errorSchema,
      },
    },
    rerun: {
      method: 'POST',
      path: '/:runId/rerun',
      description: "Start a new run on a run's clips, with different options.",
      pathParams: runParams,
      body: z.object({
        options: runOptionsSchema.optional(),
        label: z.string().trim().min(1).max(200).optional(),
      }),
      responses: {
        201: queuedSchema.extend({ runId: z.string() }),
        404: errorSchema,
      },
    },
    get: {
      method: 'GET',
      path: '/:runId',
      description: 'A run, with how many of its clips are in each state.',
      pathParams: runParams,
      responses: {
        200: runSchema,
        404: errorSchema,
      },
    },
    clipJobs: {
      method: 'GET',
      path: '/:runId/clip-jobs',
      description:
        "A page of a run's clip jobs, with their clips and results. Pass the cursor back for the next.",
      pathParams: runParams,
      query: z.object({
        state: clipJobStateSchema.optional(),
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      }),
      responses: {
        200: z.object({
          clipJobs: clipJobSchema.array(),
          /** Null on the last page. */
          cursor: z.string().nullable(),
        }),
        404: errorSchema,
      },
    },
    cancel: {
      method: 'POST',
      path: '/:runId/cancel',
      description:
        "Stop a run: clips that haven't started are skipped. Clips being analyzed finish.",
      pathParams: runParams,
      body: c.noBody(),
      responses: {
        200: z.object({ cancelledJobs: z.number() }),
        404: errorSchema,
      },
    },
  },
  { pathPrefix: '/runs' },
);
