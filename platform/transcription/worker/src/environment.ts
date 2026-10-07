import z from 'zod';
import {
  commaSeparated,
  createEnvironmentService,
  LocalEnvironmentModule,
  s3EnvAdapter,
} from '@libs/nest-common';

export const environmentSchema = z
  .object({
    redisUrl: z.string().min(1),
    ffmpegPath: z.string().default('ffmpeg'),

    // MARK: whisper vars
    whisperCliPath: z.string().default('whisper-cli'),
    whisperModelsDir: z.string().default('/models'),
    whisperModels: commaSeparated.pipe(z.tuple([z.string()], z.string())),
    whisperDefaultModel: z.string().optional(),

    // MARK: s3 vars
    s3Endpoint: z.string(),
    s3Region: z.string(),
    s3AccessKeyId: z.string(),
    s3SecretAccessKey: z.string(),
    s3ForcePathStyle: z.stringbool(),
  })
  .refine(
    (env) =>
      !env.whisperDefaultModel ||
      env.whisperModels.includes(env.whisperDefaultModel),
    { message: 'WHISPER_DEFAULT_MODEL must be one of WHISPER_MODELS' },
  )
  .transform(({ whisperDefaultModel, ...data }) => ({
    ...s3EnvAdapter(data),
    whisperDefaultModel: whisperDefaultModel ?? data.whisperModels[0],
  }));

export class EnvironmentService extends createEnvironmentService(
  environmentSchema,
) {}

export const EnvironmentModule =
  LocalEnvironmentModule.forRoot(EnvironmentService);
