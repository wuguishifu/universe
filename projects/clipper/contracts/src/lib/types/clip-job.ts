import z from 'zod';

export const clipJobDataSchema = z.object({
  s3Key: z.string(),
  s3Bucket: z.string(),
  // ids used for matching the original file on disk
  // these may or may not exist (exist on NTFS but not on FAT32/exFAT)
  fileId: z.string().optional(),
  fileGuid: z.string().optional(),
  // fallback if the fid/guid don't exist
  originalPathOnDisk: z.string(),
});
export type ClipJobData = z.infer<typeof clipJobDataSchema>;

export const clipJobResultSchema = z.discriminatedUnion('found', [
  z.object({
    found: z.literal(true),
    transcription: z.string(),
    quoteStart: z.string(),
    quoteEnd: z.string(),
    startSeconds: z.number(),
    endSeconds: z.number(),
    clipTitle: z.string(),
  }),
  z.object({
    found: z.literal(false),
    reasoning: z.string(),
  }),
]);
