import { preprocessDate, preprocessJsonArray } from '@wuguishifu/utils-parse';
import z from 'zod';

import { preprocessTickSize } from '../utils';

export type Market = z.infer<typeof marketSchema>;
export const marketSchema = z
  .object({
    conditionId: z.string(),
    clobTokenIds: z.preprocess(preprocessJsonArray, z.tuple([z.string(), z.string()])),
    slug: z.string(),
    question: z.string(),
    endDate: z.preprocess(preprocessDate, z.date()),
    startDate: z.preprocess(preprocessDate, z.date()),
    eventStartTime: z.preprocess(preprocessDate, z.date()),
    orderPriceMinTickSize: z.preprocess(preprocessTickSize, z.enum(['0.1', '0.01', '0.001', '0.0001'])),
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
