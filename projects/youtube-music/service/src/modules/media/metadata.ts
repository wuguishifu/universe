import { z } from 'zod';

const optionalString = z.string().nullish();

/** The parts of yt-dlp's info JSON this uses. */
export const videoInfoSchema = z.object({
  id: z.string(),
  title: optionalString,
  /** YouTube Music's own metadata, on official uploads ("Topic" channels, labels). */
  track: optionalString,
  artist: optionalString,
  artists: z.string().array().nullish(),
  album: optionalString,
  channel: optionalString,
  uploader: optionalString,
  duration: z.number().nullish(),
  is_live: z.boolean().nullish(),
  live_status: optionalString,
});
export type VideoInfo = z.infer<typeof videoInfoSchema>;

/** yt-dlp's `--flat-playlist -J` output. */
export const playlistInfoSchema = z.object({
  title: optionalString,
  entries: z
    .object({ id: z.string().nullish(), title: optionalString })
    .array()
    .nullish(),
});

export type TrackMetadata = {
  title: string;
  artist: string | null;
  album: string | null;
  durationSec: number | null;
};

/** "Artist - Title", with any kind of dash. */
const ARTIST_TITLE = /^(.+?)\s+[-–—]\s+(.+)$/;

/** Bracketed bits of a video title that describe the video rather than the song. */
const NOISE =
  /\s*[([](?:official\b[^)\]]*|(?:(?:hd|hq|4k)\s*)?(?:music\s*video|lyric\s*video|lyrics?|video|audio|visuali[sz]er|m\/?v|hd|hq|4k)(?:\s*(?:hd|hq|4k))?)[)\]]/gi;
/** The same, unbracketed at the end, as in "Song M/V". */
const TRAILING_NOISE = /\s+(?:m\/v|mv|official\s+(?:music\s+)?video)$/i;

/**
 * Title, artist and album for a video. Official uploads have them; for anything else, a title like
 * "Artist - Song (Official Video)" is split up and cleaned, and the channel stands in for the artist.
 */
export function trackMetadata(info: VideoInfo): TrackMetadata {
  const channel = channelName(info.channel ?? info.uploader);
  const durationSec = info.duration ?? null;

  if (info.track) {
    const artist = info.artists?.length
      ? info.artists.join(', ')
      : (info.artist ?? channel);
    return {
      title: info.track,
      artist: artist || null,
      album: info.album ?? null,
      durationSec,
    };
  }

  const title = cleanTitle(info.title ?? info.id);
  const split = ARTIST_TITLE.exec(title);
  if (split?.[1] && split[2]) {
    return {
      title: split[2],
      artist: split[1],
      album: info.album ?? null,
      durationSec,
    };
  }
  return { title, artist: channel, album: info.album ?? null, durationSec };
}

export function cleanTitle(title: string): string {
  const cleaned = title
    .replace(NOISE, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(TRAILING_NOISE, '');
  return cleaned || title.trim();
}

/** "Artist - Topic" and "ArtistVEVO" are YouTube's names for an artist's channels. */
function channelName(name: string | null | undefined): string | null {
  const cleaned = name
    ?.replace(/\s+-\s+Topic$/, '')
    .replace(/VEVO$/, '')
    .trim();
  return cleaned || name || null;
}

/** Live streams never finish, so they can't be downloaded as a track. */
export const isLive = (info: VideoInfo) =>
  info.is_live === true ||
  info.live_status === 'is_live' ||
  info.live_status === 'is_upcoming';
