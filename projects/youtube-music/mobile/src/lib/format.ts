import type { Track } from '@projects/youtube-music-contracts';

/** 3:07, or 1:02:03 for anything an hour or longer. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0)
    return '–:––';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** 1.2 GB, 34 MB, 512 KB. */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** "12 songs, 48 min" for a set of tracks. */
export function describeTracks(tracks: Pick<Track, 'durationSec'>[]): string {
  const minutes = Math.round(
    tracks.reduce((sum, t) => sum + (t.durationSec ?? 0), 0) / 60,
  );
  const songs = `${tracks.length} ${tracks.length === 1 ? 'song' : 'songs'}`;
  if (minutes === 0) return songs;
  return minutes >= 60
    ? `${songs}, ${Math.floor(minutes / 60)} hr ${minutes % 60} min`
    : `${songs}, ${minutes} min`;
}

/** Until the server has read the video's info there's no title, and there never is if that failed. */
export const trackTitle = (
  track: Pick<Track, 'title' | 'status' | 'youtubeId'>,
) =>
  track.title ??
  (track.status === 'failed'
    ? `YouTube video ${track.youtubeId}`
    : 'Fetching info…');

export const trackArtist = (track: Pick<Track, 'artist'>) =>
  track.artist ?? 'Unknown artist';

/** Sort key that ignores case and a leading "The". */
export const sortKey = (value: string | null) =>
  (value ?? '').toLocaleLowerCase().replace(/^the\s+/, '');
