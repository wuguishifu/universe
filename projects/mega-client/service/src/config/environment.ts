import { z } from 'zod';

import { isAbsolute } from 'node:path';

import {
  baseEnvironmentSchema,
  createEnvironmentService,
  LocalEnvironmentModule,
} from '@libs/nest-core';

export type EnvironmentSchema = z.infer<typeof environmentSchema>;
export const environmentSchema = baseEnvironmentSchema.extend({
  /** Where downloads land. MEGAcmd's server resolves relative paths against its own directory. */
  downloadPath: z
    .string()
    .refine(isAbsolute, 'DOWNLOAD_PATH must be an absolute path'),
  /** MEGAcmd's CLI. On macOS it's inside the app bundle, which isn't on the PATH. */
  megaExec: z.string().min(1).default('mega-exec'),
});

export class EnvironmentService extends createEnvironmentService(
  environmentSchema,
) {}

export const EnvironmentModule =
  LocalEnvironmentModule.forRoot(EnvironmentService);
