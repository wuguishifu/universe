import { createHash } from 'node:crypto';
import { ClipMetadata } from '@projects/clipper-contracts';

export function getFileId(metadata: ClipMetadata): string {
  return createHash('sha256')
    .update(metadata.fileId ?? metadata.fileGuid ?? metadata.originalPathOnDisk)
    .digest('hex')
    .slice(0, 16);
}
