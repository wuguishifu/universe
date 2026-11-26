// No imports beyond Node's, so the spec can run this file on Node's type stripping.
import path from 'node:path';

const CONTENT_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.ts': 'video/mp2t',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.srt': 'application/x-subrip',
  '.vtt': 'text/vtt',
  '.json': 'application/json',
  '.txt': 'text/plain',
};

/** The content type for an S3 key, from its extension. */
export function contentTypeFor(key: string): string {
  return (
    CONTENT_TYPES[path.posix.extname(key).toLowerCase()] ??
    'application/octet-stream'
  );
}
