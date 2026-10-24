import z from 'zod';

import {
  commaSeparated,
  createEnvironmentService,
  LocalEnvironmentModule,
} from '@libs/nest-core';
import { s3EnvAdapter } from '@libs/nest-s3';

export const environmentSchema = z
  .object({
    redisUrl: z.string().min(1),
    ffmpegPath: z.string().default('ffmpeg'),

    // MARK: whisper vars
    whisperCliPath: z.string().default('whisper-cli'),
    whisperModelsDir: z.string().default('/models'),
    whisperModels: commaSeparated.pipe(z.tuple([z.string()], z.string())),
    whisperDefaultModel: z.string().optional(),

    // MARK: diarizer vars
    /** The `diarize` command from platform/transcription/diarizer. Without it, jobs can't `diarize`. */
    diarizerPath: z.string().optional(),
    /** A local copy of pyannote/speaker-diarization-community-1. */
    diarizerModelDir: z.string().optional(),

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
  .refine((env) => !env.diarizerPath === !env.diarizerModelDir, {
    message: 'DIARIZER_PATH and DIARIZER_MODEL_DIR must be set together',
  })
  .transform(({ whisperDefaultModel, ...data }) => ({
    ...s3EnvAdapter(data),
    whisperDefaultModel: whisperDefaultModel ?? data.whisperModels[0],
  }));

export class EnvironmentService extends createEnvironmentService(
  environmentSchema,
) {}

export const EnvironmentModule =
  LocalEnvironmentModule.forRoot(EnvironmentService);
