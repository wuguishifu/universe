import { z } from 'zod';

// TODO: all the h264_nvenc options can be found here: https://gist.github.com/nico-lab/e1ba48c33bf2c7e1d9ffdd9c1b8d0493 but they differ from local options
// TODO: we should have different sets of options per environment (local, cloud run, k8s, etc).

/**
 * FFmpeg quality/speed preset. Faster presets are lower quality.
 *
 * Defaults to `p5`.
 */
export const presetLiterals = [
  'default',
  /** hq 2 passes */
  'slow',
  /** hq 1 pass */
  'medium',
  /** hp 1 pass */
  'fast',
  'hp',
  'hq',
  'bd',
  /** low latency */
  'll',
  /** low latency hq */
  'llhq',
  /** low latency hp */
  'llhp',
  'lossless',
  'losslesshp',
  /** fastest (lowest quality) */
  'p1',
  /** faster (lower quality) */
  'p2',
  /** fast (low quality) */
  'p3',
  /** medium (default) */
  'p4',
  /** slow (good quality) */
  'p5',
  /** slower (better quality) */
  'p6',
  /** slowest (best quality) */
  'p7',
] as const;
export const presetSchema = z.enum(presetLiterals);
export type PresetSchema = z.infer<typeof presetSchema>;
export const DEFAULT_PRESET: PresetSchema = 'p5';

/**
 * CRF (Constant Rate Factor) is a quality setting for video encoding that balances file size and visual quality on a scale from 0 to 51:
 * - Lower values (18-23) yield higher quality and larger file sizes.
 * - Higher values (28-51) result in lower quality and smaller file sizes.
 *
 * Usually default around 23.
 */
export const crfSchema = z
  .number()
  .min(0, { message: 'Must be 0 or greater.' })
  .max(51, { message: 'Must be 51 or lower.' });
export type CrfSchema = z.infer<typeof crfSchema>;
export const DEFAULT_CRF = 23;

/**
 * Audio codec to use. Options:
 * - `aac`: Good universal codec.
 * - `copy`: Lossless copy of original audio (may have compatibility issues with some containers).\
 *   Note: we usually do mov -> mov which is (generally) compatible.
 * - `pcm`: Uncompressed WAV format.
 * - `alac`: Apple Lossless Audio Codec.
 * - `mp3`: Older lossy format.
 */
export const caLiterals = ['aac', 'copy', 'pcm', 'alac', 'mp3'] as const;
export const caSchema = z.enum(caLiterals);
export type CASchema = z.infer<typeof caSchema>;
export const DEFAULT_CA: CASchema = 'copy';

/**
 * Audio bitrate (only relevant if `ca` is `aac` or `mp3`).\
 * Examples: `128k`, `192k`, `2M`, etc.
 *
 * If `ca` is not set to `aac` or `mp3`, this value is ignored.
 */
export const baSchema = z.string().regex(/^(|\d+(k|M)?)$/);
export type BASchema = z.infer<typeof baSchema>;
export const CODECS_THAT_REQUIRE_BA = new Set(['aac', 'mp3']);
export const DEFAULT_BA = undefined;

/**
 * Output container formats
 */
export const outputContainerLiterals = ['mp4', 'mov', 'mkv', 'webm'] as const;
export const outputContainerSchema = z.enum(outputContainerLiterals);
export type OutputContainerSchema = z.infer<typeof outputContainerSchema>;
export const DEFAULT_OUTPUT_CONTAINER: OutputContainerSchema = 'mp4';

export const experimentalAudioSyncLiterals = [
  'enabled',
  'disabled',
  'auto',
] as const;
export const experimentalAudioSyncSchema = z.enum(
  experimentalAudioSyncLiterals,
);
export type ExperimentalAudioSyncSchema = z.infer<
  typeof experimentalAudioSyncSchema
>;
export const DEFAULT_EXPERIMENTAL_AUDIO_SYNC: ExperimentalAudioSyncSchema =
  'auto';

/**
 * Schema for FFmpeg flags used in video processing.\
 * See `libs/titan/src/db/schemas/episodeSplitting.ts` for more information.
 */
export const ffmpegFlagsSchema = z
  .object({
    preset: presetSchema,
    crf: crfSchema,
    ca: caSchema,
    ba: baSchema.optional(),
    useExperimentalStreamMapping: z.boolean().optional(),
    useExperimentalAudioSync: experimentalAudioSyncSchema.optional(),
    outputContainer: outputContainerSchema.optional(),
  })
  .refine(
    (data) => {
      if (CODECS_THAT_REQUIRE_BA.has(data.ca)) {
        return data.ba !== undefined;
      }

      return true;
    },
    {
      path: ['ba'],
      message:
        'Audio bitrate (b:a) is required when using "aac" or "mp3" audio codec (c:a).',
    },
  );
export type FFmpegFlags = z.infer<typeof ffmpegFlagsSchema>;
