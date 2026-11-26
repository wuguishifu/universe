// Only imports zod, so the spec can run this file on Node's type stripping.
import { z } from 'zod';

// MARK: placeholders

export type PlaceholderKind = 'in' | 'out' | 'tmp';
export type Placeholder = { kind: PlaceholderKind; name: string };

/**
 * Names of inputs, outputs and scratch files: no slashes, and no dot first (so never `.` or `..`),
 * so a name can't point outside the job's work dir.
 */
export const FILE_NAME_PATTERN = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;

/** `{{ in:clip }}` or `{{in:clip}}`: spaces inside the braces only, never around the colon. */
const PLACEHOLDER_PATTERN =
  /^\{\{\s*(in|out|tmp):([A-Za-z0-9_-][A-Za-z0-9_.-]*)\s*\}\}$/;
const BRACES_PATTERN = /\{\{.*?\}\}/g;

const isKind = (kind: string | undefined): kind is PlaceholderKind =>
  kind === 'in' || kind === 'out' || kind === 'tmp';

function toPlaceholder(text: string): Placeholder | null {
  const [, kind, name] = PLACEHOLDER_PATTERN.exec(text) ?? [];
  return isKind(kind) && name ? { kind, name } : null;
}

/**
 * The placeholders in one arg. Anything in `{{ }}` that isn't a valid placeholder, and any `{{` or
 * `}}` left over, is `invalid`: ffmpeg args basically never contain them, so they're typos.
 */
export function parseArg(arg: string): {
  placeholders: Placeholder[];
  invalid: string[];
} {
  const placeholders: Placeholder[] = [];
  const invalid: string[] = [];
  for (const [text] of arg.matchAll(BRACES_PATTERN)) {
    const placeholder = toPlaceholder(text);
    if (placeholder) {
      placeholders.push(placeholder);
    } else {
      invalid.push(text);
    }
  }
  const rest = arg.replace(BRACES_PATTERN, '');
  if (rest.includes('{{') || rest.includes('}}')) {
    invalid.push(arg);
  }
  return { placeholders, invalid };
}

/** Replaces each placeholder in `arg` with `resolve`'s path for it. */
export function substituteArg(
  arg: string,
  resolve: (placeholder: Placeholder) => string,
): string {
  if (parseArg(arg).invalid.length > 0) {
    throw new Error(`Invalid placeholder in "${arg}"`);
  }
  return arg.replace(BRACES_PATTERN, (text) => {
    const placeholder = toPlaceholder(text);
    if (!placeholder) throw new Error(`Invalid placeholder ${text}`);
    return resolve(placeholder);
  });
}

// MARK: request

const fileNameSchema = z
  .string()
  .regex(
    FILE_NAME_PATTERN,
    'Names can only have letters, digits, "_", "-" and "." (not first)',
  );

const s3ObjectSchema = z.object({
  type: z.literal('s3'),
  bucket: z.string().min(1),
  /** Any key, nested or not. Its extension is kept locally, since ffmpeg goes by it. */
  key: z.string().min(1),
});

export const ffmpegInputSchema = z.discriminatedUnion('type', [s3ObjectSchema]);
export type FfmpegInput = z.infer<typeof ffmpegInputSchema>;

export const ffmpegOutputSchema = z.discriminatedUnion('type', [
  s3ObjectSchema.extend({
    /** Defaults to one from the key's extension. */
    contentType: z.string().min(1).optional(),
  }),
]);
export type FfmpegOutput = z.infer<typeof ffmpegOutputSchema>;

export const ffmpegStepSchema = z.object({
  /**
   * ffmpeg's args, after `-hide_banner -nostdin -y`. Files are placeholders: `{{ in:name }}` and
   * `{{ out:name }}` for `inputs` and `outputs`, `{{ tmp:name }}` for scratch files every step can
   * see (e.g. `-passlogfile {{ tmp:pass }}`). They're replaced inside args too, as in
   * `-vf subtitles={{ in:subs }}`.
   */
  args: z.array(z.string()).min(1),
  /**
   * How long the step's output will be, for progress. Without it, progress goes by the longest
   * input the step reads, which overshoots for a trim.
   */
  expectedDurationMs: z.number().positive().optional(),
});
export type FfmpegStep = z.infer<typeof ffmpegStepSchema>;

export const MAX_FFMPEG_STEPS = 20;

export const ffmpegRequestSchema = z
  .object({
    /** Downloaded before the first step, as `in/<name><key's extension>`. */
    inputs: z.record(fileNameSchema, ffmpegInputSchema),
    /** Uploaded once every step has succeeded; existing objects are overwritten. */
    outputs: z
      .record(fileNameSchema, ffmpegOutputSchema)
      .refine((outputs) => Object.keys(outputs).length > 0, {
        message: 'A job needs at least one output',
      }),
    /** Run in order, in one work dir; only files pass between them. */
    steps: z.array(ffmpegStepSchema).min(1).max(MAX_FFMPEG_STEPS),
    /** For all the steps together. The worker has a default and a cap (10 minutes and 2 hours). */
    timeoutMs: z.number().int().positive().optional(),
  })
  .superRefine((request, ctx) => {
    const read = new Set<string>();
    const written = new Set<string>();
    /** Scratch file names by their case-folded form: macOS disks don't tell `A` from `a`. */
    const scratch = new Map<string, string>();
    request.steps.forEach((step, i) => {
      step.args.forEach((arg, j) => {
        const path = ['steps', i, 'args', j];
        const { placeholders, invalid } = parseArg(arg);
        for (const text of invalid) {
          ctx.addIssue({
            code: 'custom',
            path,
            message: `"${text}" isn't a placeholder: use {{ in:name }}, {{ out:name }} or {{ tmp:name }}`,
          });
        }
        for (const { kind, name } of placeholders) {
          if (kind === 'in') {
            read.add(name);
            if (!(name in request.inputs)) {
              ctx.addIssue({
                code: 'custom',
                path,
                message: `No input named "${name}"`,
              });
            }
          } else if (kind === 'out') {
            written.add(name);
            if (!(name in request.outputs)) {
              ctx.addIssue({
                code: 'custom',
                path,
                message: `No output named "${name}"`,
              });
            }
          } else {
            const folded = foldCase(name);
            const other = scratch.get(folded);
            if (other !== undefined && other !== name) {
              ctx.addIssue({
                code: 'custom',
                path,
                message: `Scratch files "${other}" and "${name}" would be one file on a case-insensitive disk`,
              });
            }
            scratch.set(folded, other ?? name);
          }
        }
      });
    });

    for (const name of Object.keys(request.inputs)) {
      if (!read.has(name)) {
        ctx.addIssue({
          code: 'custom',
          path: ['inputs', name],
          message: `No step reads input "${name}"`,
        });
      }
    }
    const destinations = new Map<string, string>();
    for (const [name, output] of Object.entries(request.outputs)) {
      if (!written.has(name)) {
        ctx.addIssue({
          code: 'custom',
          path: ['outputs', name],
          message: `No step writes output "${name}"`,
        });
      }
      const destination = `${output.bucket}/${output.key}`;
      const other = destinations.get(destination);
      if (other) {
        ctx.addIssue({
          code: 'custom',
          path: ['outputs', name],
          message: `Outputs "${other}" and "${name}" are both s3://${destination}`,
        });
      }
      destinations.set(destination, name);
    }
  });
export type FfmpegRequest = z.infer<typeof ffmpegRequestSchema>;

/** How a case-insensitive, normalization-insensitive disk (macOS's default) compares names. */
export function foldCase(name: string): string {
  return name.normalize('NFC').toLowerCase();
}

// MARK: result

export const ffmpegStreamSchema = z.object({
  index: z.number().int(),
  /** ffprobe's `codec_type`: video, audio, subtitle, data or attachment. */
  type: z.string(),
  codec: z.string().optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  fps: z.number().optional(),
  sampleRate: z.number().int().optional(),
  channels: z.number().int().optional(),
});
export type FfmpegStream = z.infer<typeof ffmpegStreamSchema>;

export const ffmpegProbeSchema = z.object({
  durationMs: z.number().optional(),
  /** ffprobe's `format_name`, e.g. "mov,mp4,m4a,3gp,3g2,mj2". */
  format: z.string().optional(),
  streams: ffmpegStreamSchema.array(),
});
export type FfmpegProbe = z.infer<typeof ffmpegProbeSchema>;

export const ffmpegOutputResultSchema = z.object({
  bucket: z.string(),
  key: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int(),
  /** Missing when ffprobe can't read the file (e.g. a text file). */
  probe: ffmpegProbeSchema.optional(),
});
export type FfmpegOutputResult = z.infer<typeof ffmpegOutputResultSchema>;

export const ffmpegResultSchema = z.object({
  outputs: z.record(z.string(), ffmpegOutputResultSchema),
  analytics: z.object({
    waitTimeMs: z.number(),
    downloadMs: z.number(),
    /** One per step, in order. */
    stepsMs: z.number().array(),
    probeMs: z.number(),
    uploadMs: z.number(),
    totalMs: z.number(),
  }),
});
export type FfmpegResult = z.infer<typeof ffmpegResultSchema>;
