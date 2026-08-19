'use server';

import { redirect } from 'next/navigation';
import { silverApi } from '../../modules/server/silver-api';
import { extractYoutubeVideoId, isYoutubeVideoId } from './lib/youtube';

export type ConvertFormState = { error: string } | null;

export async function requestConversion(
  _prevState: ConvertFormState,
  formData: FormData,
): Promise<ConvertFormState> {
  const input = formData.get('url');
  const videoId =
    typeof input === 'string' ? extractYoutubeVideoId(input) : null;
  if (!videoId) return { error: 'enter a valid youtube watch link' };

  try {
    const result = await silverApi.converter.convert({ body: { videoId } });
    if (result.status !== 200) return { error: 'failed to queue conversion' };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : 'failed to queue conversion',
    };
  }

  redirect(`/youtube-to-mp3/${videoId}`);
}

export type DownloadUrlResult =
  | { success: true; url: string }
  | { success: false; error: string };

export async function getDownloadUrl(
  videoId: string,
): Promise<DownloadUrlResult> {
  if (!isYoutubeVideoId(videoId)) {
    return { success: false, error: 'invalid video id' };
  }

  try {
    const result = await silverApi.url.getSignedUrl({
      query: { s3Key: `${videoId}.mp3` },
    });
    if (result.status !== 200) {
      return { success: false, error: 'failed to get download link' };
    }

    return { success: true, url: result.body };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : 'failed to get download link',
    };
  }
}
