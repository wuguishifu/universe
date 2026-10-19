export type YoutubeLink =
  { kind: 'video'; videoId: string } | { kind: 'playlist'; playlistId: string };

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID = /^[A-Za-z0-9_-]{10,}$/;
const HOSTS = new Set([
  'youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
]);
/** Paths whose next segment is the video ID. */
const VIDEO_PATHS = new Set(['shorts', 'live', 'embed', 'v']);

/**
 * The video or playlist a YouTube link points to, or null if it isn't one. A video watched inside a
 * playlist (`watch?v=…&list=…`) is just the video.
 */
export function parseYoutubeUrl(input: string): YoutubeLink | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const [first, second] = url.pathname.split('/').filter(Boolean);

  if (host === 'youtu.be') return video(first);
  if (!HOSTS.has(host)) return null;

  if (first === 'watch') return video(url.searchParams.get('v'));
  if (first && VIDEO_PATHS.has(first)) return video(second);
  if (first === 'playlist') {
    const playlistId = url.searchParams.get('list');
    return playlistId && PLAYLIST_ID.test(playlistId)
      ? { kind: 'playlist', playlistId }
      : null;
  }
  return null;
}

/**
 * The first YouTube link in some shared text. Apps share links on their own, or inside text like
 * "Check this out https://youtu.be/…".
 */
export function findYoutubeLink(text: string): YoutubeLink | null {
  for (const candidate of text.match(/https?:\/\/\S+/g) ?? []) {
    const link = parseYoutubeUrl(candidate);
    if (link) return link;
  }
  return null;
}

export const youtubeVideoUrl = (videoId: string) =>
  `https://www.youtube.com/watch?v=${videoId}`;

export const youtubePlaylistUrl = (playlistId: string) =>
  `https://www.youtube.com/playlist?list=${playlistId}`;

function video(id: string | null | undefined): YoutubeLink | null {
  return id && VIDEO_ID.test(id) ? { kind: 'video', videoId: id } : null;
}
