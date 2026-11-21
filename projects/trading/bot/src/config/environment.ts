import { z } from 'zod';

import {
  baseEnvironmentSchema,
  createEnvironmentService,
  LocalEnvironmentModule,
} from '@libs/nest-core';

import { hostSettingsSchema } from '../host/settings';

export const environmentSchema = baseEnvironmentSchema
  .extend({
    apcaApiKeyId: z.string().min(1),
    apcaApiSecretKey: z.string().min(1),
    /** Must be Alpaca's paper API; anything else stops the app at startup. */
    apcaApiBaseUrl: z
      .string()
      .url()
      .default('https://paper-api.alpaca.markets'),
    apcaDataUrl: z.string().url().default('https://data.alpaca.markets'),
    apcaStreamUrl: z.string().default('wss://stream.data.alpaca.markets'),
    /** Spacing between REST calls; 300ms keeps the free plan's 200 a minute. */
    apcaMinIntervalMs: z.coerce.number().int().nonnegative().default(300),

    /** Only the pre-market box is wired up for live trading so far. */
    strategy: z
      .enum(['premarket-box-breakout'])
      .default('premarket-box-breakout'),

    universeDbConnectionString: z.string().min(1),
    /** JSON lines on stdout; set false for readable local logs. */
    logJson: z.stringbool().default(true),
    port: z.coerce.number().int().positive().default(3013),
  })
  .extend(hostSettingsSchema.shape);
export type EnvironmentSchema = z.infer<typeof environmentSchema>;

export class EnvironmentService extends createEnvironmentService(
  environmentSchema,
) {}

export const EnvironmentModule =
  LocalEnvironmentModule.forRoot(EnvironmentService);
