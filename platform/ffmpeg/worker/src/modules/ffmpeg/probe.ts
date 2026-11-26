// Only zod and type imports, so the spec can run this file on Node's type stripping.
import { z } from 'zod';

import type { FfmpegProbe, FfmpegStream } from '@platform/ffmpeg-contracts';

/** The parts of `ffprobe -print_format json -show_format -show_streams` that a probe keeps. */
const ffprobeJsonSchema = z.object({
  format: z
    .object({
      format_name: z.string().optional(),
      duration: z.string().optional(),
    })
    .optional(),
  streams: z
    .array(
      z.object({
        index: z.number(),
        codec_type: z.string().optional(),
        codec_name: z.string().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
        avg_frame_rate: z.string().optional(),
        r_frame_rate: z.string().optional(),
        sample_rate: z.string().optional(),
        channels: z.number().optional(),
      }),
    )
    .default([]),
});

export function toProbe(ffprobeOutput: string): FfmpegProbe {
  const { format, streams } = ffprobeJsonSchema.parse(
    JSON.parse(ffprobeOutput),
  );
  const durationSec = Number(format?.duration);
  return {
    durationMs: Number.isFinite(durationSec)
      ? Math.round(durationSec * 1000)
      : undefined,
    format: format?.format_name,
    streams: streams.map((stream): FfmpegStream => ({
      index: stream.index,
      type: stream.codec_type ?? 'unknown',
      codec: stream.codec_name,
      width: stream.width,
      height: stream.height,
      fps:
        stream.codec_type === 'video'
          ? (frameRate(stream.avg_frame_rate) ?? frameRate(stream.r_frame_rate))
          : undefined,
      sampleRate: stream.sample_rate
        ? Number.parseInt(stream.sample_rate, 10)
        : undefined,
      channels: stream.channels,
    })),
  };
}

/** ffprobe gives frame rates as fractions, like "30000/1001"; "0/0" means unknown. */
function frameRate(fraction: string | undefined): number | undefined {
  const [num, den] = (fraction ?? '').split('/').map(Number);
  if (!num || !den) return undefined;
  return Math.round((num / den) * 1000) / 1000;
}
