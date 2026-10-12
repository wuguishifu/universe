import { z } from 'zod';

/**
 * Each clip is sent to Gemini as a small proxy, made by tools/scripts/media (and later the Windows
 * client) to this spec, and keyed by the SHA-256 of the original file. The scripts keep their own
 * copy of these numbers in tools/scripts/media/lib.mjs.
 */
export const PROXY = {
  /** The proxy's frame rate, so the most `fps` a run can ask for. */
  fps: 4,
  /**
   * Proxies are sent inline, as base64 (a third bigger), and Gemini takes up to 100MB of that per
   * request. 18MB becomes 24MB, so this keeps requests small rather than just under the limit.
   */
  maxBytes: 18 * 1024 * 1024,
  contentType: 'video/mp4',
};

/** Long enough for any clip whose proxy fits PROXY.maxBytes at a watchable bitrate. */
export const MAX_CLIP_DURATION_SEC = 15 * 60;

/** Per request, for adding clips to a run or asking for upload URLs. */
export const MAX_CLIPS_PER_REQUEST = 500;

export const sha256Schema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'Expected a lowercase hex SHA-256');

/** Where clips' proxies go: one object per original, whoever uploads it. */
export function createProxyS3Key(sha256: string) {
  return `proxies/${sha256}.mp4`;
}

export const clipInputSchema = z.object({
  /** Of the original file, not the proxy: a clip's identity, whatever copy of it was uploaded. */
  sha256: sha256Schema,
  /** Where the proxy is. */
  bucket: z.string().min(1),
  key: z.string().min(1),
  durationSec: z.number().positive().max(MAX_CLIP_DURATION_SEC),
  /** Where the original was on the machine that made the proxy, so it can be found to trim. */
  originalPath: z.string().min(1).max(1024),
  /** Medal's name for the game, e.g. its folder name ("Valorant") or "CallofDutyBlackOps3". */
  game: z.string().min(1).max(200).optional(),
  /** When Medal recorded it, in the recording PC's local time (no offset), e.g. "2026-01-04T20:36:37.101". */
  recordedAt: z.string().max(64).optional(),
  /** Medal's IDs for the clip, when the client knows them. */
  fileId: z.string().min(1).max(200).optional(),
  fileGuid: z.string().min(1).max(200).optional(),
});
export type ClipInput = z.infer<typeof clipInputSchema>;
