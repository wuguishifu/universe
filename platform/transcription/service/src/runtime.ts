import { z } from 'zod';

/**
 * Which parts of transcription-service this process runs. Read straight from process.env (not the
 * EnvironmentService) because it decides which modules exist, before DI is set up.
 *
 * - `api`: HTTP only. Adds jobs to the queues and waits on them. Cheap, safe to expose.
 * - `worker`: runs whisper for the enabled lanes. CPU/GPU heavy, no public routes.
 * - `all`: both, for local development.
 *
 * Lanes let a worker take only some of the work, e.g. a GPU box that runs just `batch`.
 */
const runtimeSchema = z.object({
  ROLE: z.enum(['api', 'worker', 'all']).default('all'),
  WORKER_LANES: z
    .string()
    .default('interactive,batch')
    .transform((lanes) =>
      lanes
        .split(',')
        .map((lane) => lane.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.enum(['interactive', 'batch'])).min(1)),
});

export type Runtime = {
  runsApi: boolean;
  runsWorker: boolean;
  workerLanes: ('interactive' | 'batch')[];
};

export function readRuntime(env: NodeJS.ProcessEnv = process.env): Runtime {
  const { ROLE: role, WORKER_LANES: workerLanes } = runtimeSchema.parse(env);
  return {
    runsApi: role !== 'worker',
    runsWorker: role !== 'api',
    workerLanes,
  };
}
