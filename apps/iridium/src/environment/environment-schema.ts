import z from 'zod';

export const environmentSchema = z.object({
  targetEntry: z.number().min(0).max(1).default(0.97),
});
