import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import type { Playlist, Track } from '@projects/youtube-music-contracts';
import { confirm, type SheetAction, showActionSheet } from './action-sheet';
import { useConnection } from './api';
import { downloads } from './downloads';
import { trackTitle } from './format';
import { player } from './player';
import { useDeleteTrack, useRetryTrack, useSetPlaylistTracks } from './queries';

/** The "…" menu for a track, with what makes sense for its state. */
export function useTrackActions() {
  const router = useRouter();
  const connection = useConnection();
  const deleteTrack = useDeleteTrack();
  const retryTrack = useRetryTrack();
  const setPlaylistTracks = useSetPlaylistTracks();

  return useCallback(
    (track: Track, { playlist }: { playlist?: Playlist } = {}) => {
      const ready = track.status === 'ready';
      const downloaded = downloads.isDownloaded(track.id);
      const actions: SheetAction[] = [];

      if (ready) {
        actions.push(
          { label: 'Play next', onPress: () => player.playNext(track) },
          { label: 'Add to queue', onPress: () => player.addToQueue(track) },
        );
      }
      actions.push({
        label: 'Add to playlist…',
        onPress: () =>
          router.push({
            pathname: '/add-to-playlist',
            params: { trackIds: String(track.id) },
          }),
      });
      if (ready) {
        actions.push(
          downloaded
            ? {
                label: 'Remove download',
                onPress: () => downloads.remove(track.id),
              }
            : {
                label: 'Download to phone',
                onPress: () => downloads.download([track], connection),
              },
        );
      }
      if (track.status === 'failed') {
        actions.push({
          label: 'Retry download',
          onPress: () => retryTrack.mutate(track.id),
        });
      }
      actions.push({
        label: 'Edit info',
        onPress: () =>
          router.push({ pathname: '/edit/[id]', params: { id: track.id } }),
      });
      if (playlist) {
        actions.push({
          label: `Remove from ${playlist.name}`,
          destructive: true,
          onPress: () =>
            setPlaylistTracks.mutate({
              id: playlist.id,
              trackIds: playlist.trackIds.filter((id) => id !== track.id),
            }),
        });
      }
      actions.push({
        label: 'Delete from library',
        destructive: true,
        onPress: () =>
          confirm(
            `Delete “${trackTitle(track)}”?`,
            "It's removed from the server, your playlists and this phone.",
            'Delete',
            () => {
              downloads.remove(track.id);
              deleteTrack.mutate(track.id);
            },
          ),
      });

      const subtitle =
        track.error && track.status !== 'ready' ? `\n${track.error}` : '';
      showActionSheet(`${trackTitle(track)}${subtitle}`, actions);
    },
    [router, connection, deleteTrack, retryTrack, setPlaylistTracks],
  );
}
