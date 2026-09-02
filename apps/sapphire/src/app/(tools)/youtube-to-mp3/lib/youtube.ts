const VIDEO_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;

export function isYoutubeVideoId(value: string) {
  return VIDEO_ID_REGEX.test(value);
}

export function extractYoutubeVideoId(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }

  const isYoutubeHost =
    url.hostname === 'youtube.com' || url.hostname.endsWith('.youtube.com');
  if (!isYoutubeHost || url.pathname !== '/watch') return null;

  const videoId = url.searchParams.get('v');
  if (!videoId || !isYoutubeVideoId(videoId)) return null;

  return videoId;
}
