import { z } from 'zod';
import { s3EnvAdapter } from '@universe/nest-common';

const commaSeparated = z.string().transform((value) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
);

export type EnvironmentSchema = z.infer<typeof environmentSchema>;
export const environmentSchema = z
  .object({
    debugLogging: z.stringbool().default(false),
    environment: z.enum(['development', 'production']).default('development'),
    apiToken: z.string().min(16),
    redisUrl: z.string().min(1),

    ffmpegPath: z.string().default('ffmpeg'),
    whisperCliPath: z.string().default('whisper-cli'),
    /** Directory holding `ggml-<model>.bin` files. */
    whisperModelsDir: z.string().default('/models'),
    /** Models callers may request, e.g. `base.en,small.en,large-v3-turbo`. */
    whisperModels: commaSeparated.pipe(z.tuple([z.string()], z.string())),
    /** Defaults to the first entry of whisperModels. */
    whisperDefaultModel: z.string().optional(),
    /** Silero VAD model (ggml-silero-*.bin). Enables the `vad` request option. */
    whisperVadModelPath: z.string().optional(),
    whisperThreadsInteractive: z.coerce.number().int().positive().default(4),
    whisperThreadsBatch: z.coerce.number().int().positive().default(4),
    /**
     * 1 = greedy decoding. Beam search (whisper-cli's default, 5) is a little more robust on
     * hard audio but noticeably slower, so interactive defaults to greedy and batch to beam.
     */
    whisperBeamSizeInteractive: z.coerce.number().int().positive().default(1),
    whisperBeamSizeBatch: z.coerce.number().int().positive().default(5),

    /** Optional: only needed to accept `s3` audio sources. */
    s3Endpoint: z.string().optional(),
    s3Region: z.string().default('garage'),
    s3AccessKeyId: z.string().optional(),
    s3SecretAccessKey: z.string().optional(),
    s3ForcePathStyle: z.stringbool().default(true),
  })
  .refine(
    (env) =>
      !env.whisperDefaultModel ||
      env.whisperModels.includes(env.whisperDefaultModel),
    { message: 'WHISPER_DEFAULT_MODEL must be one of WHISPER_MODELS' },
  )
  .transform(({ apiToken: apiToken, whisperDefaultModel, ...data }) => ({
    ...s3EnvAdapter(data),
    apiToken,
    whisperDefaultModel: whisperDefaultModel ?? data.whisperModels[0],
  }));
