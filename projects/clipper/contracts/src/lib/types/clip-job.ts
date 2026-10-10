import z from 'zod';

export const clipMetadata = z.object({
  // ids used for matching the original file on disk
  // these may or may not exist (exist on NTFS but not on FAT32/exFAT)
  fileId: z.string().optional(),
  fileGuid: z.string().optional(),
  // fallback if the fid/guid don't exist
  originalPathOnDisk: z.string(),
});
export type ClipMetadata = z.infer<typeof clipMetadata>;

export const preprocessClipJobDataSchema = clipMetadata.extend({
  s3Key: z.string(),
  s3Bucket: z.string(),
});
export type ClipJobData = z.infer<typeof preprocessClipJobDataSchema>;
