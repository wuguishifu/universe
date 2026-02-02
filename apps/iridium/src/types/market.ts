import { TickSize } from '@polymarket/clob-client';
import z from 'zod';

import { preprocessDate, preprocessJsonArray, preprocessTickSize } from '../utils/preprocessors';

export type Market = z.infer<typeof marketSchema>;
export const marketSchema = z
  .object({
    conditionId: z.string(),
    clobTokenIds: z.preprocess(preprocessJsonArray, z.tuple([z.string(), z.string()])),
    slug: z.string(),
    question: z.string(),
    endDate: z.preprocess(preprocessDate, z.date()),
    orderPriceMinTickSize: z.preprocess(preprocessTickSize, z.custom<TickSize>()),
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
