import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import {
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { Storage } from 'expo-sqlite/kv-store';
import { useMemo } from 'react';
import { Alert } from 'react-native';
import type {
  Playlist,
  Track,
  TrackUpdate,
} from '@projects/youtube-music-contracts';
import { expect, useApi } from './api';
import { useSettings } from './settings';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The library and playlists are persisted, so the app opens straight into them and still works
 * offline (with whatever's downloaded).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 30 * DAY_MS,
      staleTime: 10_000,
      retry: 1,
    },
  },
});

export const queryPersister = createAsyncStoragePersister({
  storage: {
    getItem: (key) => Storage.getItemAsync(key),
    setItem: (key, value) => Storage.setItemAsync(key, value),
    removeItem: async (key) => {
      await Storage.removeItemAsync(key);
    },
  },
});

export const PERSIST_MAX_AGE_MS = 30 * DAY_MS;

export const keys = {
  tracks: ['tracks'] as const,
  playlists: ['playlists'] as const,
  status: ['status'] as const,
};

const isPending = (track: Track) =>
  track.status === 'queued' || track.status === 'downloading';

export function useTracks() {
  const api = useApi();
  const { configured } = useSettings();
  return useQuery({
    queryKey: keys.tracks,
    queryFn: () => expect(api.tracks.list(), 200),
    enabled: configured,
    // Poll while something's downloading on the server, so it shows up when it's ready.
    refetchInterval: (query) =>
      query.state.data?.some(isPending) ? 3000 : false,
  });
}

/** Tracks by ID, for playlists (which only hold IDs). */
export function useTracksById(): Map<number, Track> {
  const { data } = useTracks();
  return useMemo(
    () => new Map((data ?? []).map((track) => [track.id, track])),
    [data],
  );
}

export function usePlaylists() {
  const api = useApi();
  const { configured } = useSettings();
  return useQuery({
    queryKey: keys.playlists,
    queryFn: () => expect(api.playlists.list(), 200),
    enabled: configured,
  });
}

export function usePlaylist(id: number): Playlist | undefined {
  const { data } = usePlaylists();
  return data?.find((p) => p.id === id);
}

/** A mutation that refreshes the library afterwards and shows failures in an alert. */
function useLibraryMutation<Variables, Result>(
  mutationFn: (variables: Variables) => Promise<Result>,
  { errorTitle }: { errorTitle: string },
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () => {
      void client.invalidateQueries({ queryKey: keys.tracks });
      void client.invalidateQueries({ queryKey: keys.playlists });
    },
    onError: (error) => Alert.alert(errorTitle, error.message),
  });
}

/** Import throws to the caller rather than alerting: the add screen shows the error itself. */
export function useImport() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (url: string) => expect(api.import({ body: { url } }), 200),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: keys.tracks });
      void client.invalidateQueries({ queryKey: keys.playlists });
    },
  });
}

export function useUpdateTrack() {
  const api = useApi();
  return useLibraryMutation(
    ({ id, ...body }: TrackUpdate & { id: number }) =>
      expect(api.tracks.update({ params: { id }, body }), 200),
    { errorTitle: "Couldn't save" },
  );
}

export function useDeleteTrack() {
  const api = useApi();
  return useLibraryMutation(
    (id: number) => expect(api.tracks.remove({ params: { id } }), 204),
    { errorTitle: "Couldn't delete" },
  );
}

export function useRetryTrack() {
  const api = useApi();
  return useLibraryMutation(
    (id: number) => expect(api.tracks.retry({ params: { id } }), 200),
    { errorTitle: "Couldn't retry" },
  );
}

export function useCreatePlaylist() {
  const api = useApi();
  return useLibraryMutation(
    (name: string) => expect(api.playlists.create({ body: { name } }), 201),
    { errorTitle: "Couldn't create the playlist" },
  );
}

export function useRenamePlaylist() {
  const api = useApi();
  return useLibraryMutation(
    ({ id, name }: { id: number; name: string }) =>
      expect(api.playlists.rename({ params: { id }, body: { name } }), 200),
    { errorTitle: "Couldn't rename the playlist" },
  );
}

export function useDeletePlaylist() {
  const api = useApi();
  return useLibraryMutation(
    (id: number) => expect(api.playlists.remove({ params: { id } }), 204),
    { errorTitle: "Couldn't delete the playlist" },
  );
}

export function useAddToPlaylist() {
  const api = useApi();
  return useLibraryMutation(
    ({ id, trackIds }: { id: number; trackIds: number[] }) =>
      expect(
        api.playlists.addTracks({ params: { id }, body: { trackIds } }),
        200,
      ),
    { errorTitle: "Couldn't add to the playlist" },
  );
}

/** Reorders or removes. Updates the cached playlist right away, so moving tracks feels instant. */
export function useSetPlaylistTracks() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, trackIds }: { id: number; trackIds: number[] }) =>
      expect(
        api.playlists.setTracks({ params: { id }, body: { trackIds } }),
        200,
      ),
    onMutate: ({ id, trackIds }) => {
      client.setQueryData<Playlist[]>(keys.playlists, (playlists) =>
        playlists?.map((p) => (p.id === id ? { ...p, trackIds } : p)),
      );
    },
    onSettled: () =>
      void client.invalidateQueries({ queryKey: keys.playlists }),
    onError: (error) =>
      Alert.alert("Couldn't update the playlist", error.message),
  });
}

export function useSyncPlaylist() {
  const api = useApi();
  return useLibraryMutation(
    (id: number) => expect(api.playlists.sync({ params: { id } }), 200),
    { errorTitle: "Couldn't sync with YouTube" },
  );
}

export function useServerStatus() {
  const api = useApi();
  const { configured } = useSettings();
  return useQuery({
    queryKey: keys.status,
    queryFn: () => expect(api.status(), 200),
    enabled: configured,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
}
