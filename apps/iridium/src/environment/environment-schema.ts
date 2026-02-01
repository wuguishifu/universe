import z from 'zod';

export const environmentSchema = z.object({
  targetEntry: z.number().min(0).max(1).default(0.97),
  minTimeRemainingMs: z.number().min(0).default(300_000),
  minTimeElapsedMs: z.number().min(0).default(0),
  targetPositionSize: z.number().min(0).default(50),
  panicExitDelayMs: z.number().min(0).default(120_000),
});
