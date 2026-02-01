import z from 'zod';

import { preprocessDate, preprocessJsonArray } from '../utils/preprocessors';

export type Market = z.infer<typeof marketSchema>;
export const marketSchema = z
  .object({
    id: z.string(),
    conditionId: z.string(),
    clobTokenIds: z.preprocess(preprocessJsonArray, z.tuple([z.string(), z.string()])),
    slug: z.string(),
    question: z.string(),
    endDate: z.preprocess(preprocessDate, z.date()),
  })
  .transform((data) => {
    const asset = data.slug.split('-')[0];

    return {
      ...data,
      yesToken: data.clobTokenIds[0],
      noToken: data.clobTokenIds[1],
      asset,
      timeframe: '1h',
    };
  });
