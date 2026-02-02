import z from 'zod';

import { marketSchema } from './market';

export type Event = z.infer<typeof eventSchema>;
export const eventSchema = z.object({
  id: z.string(),
  slug: z.string(),
  markets: marketSchema.array(),
});
