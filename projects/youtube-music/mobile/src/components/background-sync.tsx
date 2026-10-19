import { focusManager, useQueryClient } from '@tanstack/react-query';
import { useRootNavigationState, useRouter } from 'expo-router';
import { useShareIntentContext } from 'expo-share-intent';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useConnection } from '../lib/api';
import { downloads } from '../lib/downloads';
import { player } from '../lib/player';
import { useTracks, useTracksById } from '../lib/queries';
import { useSettings } from '../lib/settings';

/** Refetch when the app comes back to the foreground, like a browser tab regaining focus. */
focusManager.setEventListener((setFocused) => {
  const subscription = AppState.addEventListener('change', (state) =>
    setFocused(state === 'active'),
  );
  return () => subscription.remove();
});

/** Keeps the player and the downloads in step with the settings and the library. Renders nothing. */
export function BackgroundSync() {
  const { settings } = useSettings();
  const connection = useConnection();
  const queryClient = useQueryClient();
  const tracks = useTracks();
  const byId = useTracksById();

  useEffect(() => {
    player.configure({
      connection,
      normalizeVolume: settings.normalizeVolume,
    });
  }, [connection, settings.normalizeVolume]);

  // A new address or token: fetch everything again with it.
  const firstConnection = useRef(connection);
  useEffect(() => {
    if (connection !== firstConnection.current) {
      void queryClient.invalidateQueries();
    }
  }, [connection, queryClient]);

  // Show edits and finished downloads in the queue.
  useEffect(() => {
    player.refreshTracks(byId);
  }, [byId]);

  // Only trust a fresh listing to say what's been deleted, not one restored from the cache.
  const fresh = tracks.isFetchedAfterMount && tracks.isSuccess;
  useEffect(() => {
    if (fresh && tracks.data) {
      downloads.prune(new Set(tracks.data.map((t) => t.id)));
    }
  }, [fresh, tracks.data]);

  useEffect(() => {
    if (settings.autoDownload && tracks.data) {
      downloads.download(tracks.data, connection);
    }
  }, [settings.autoDownload, tracks.data, connection]);

  return <ShareIntentHandler />;
}

/** Sends a link shared to the app (e.g. from YouTube's share sheet) to the add screen. */
function ShareIntentHandler() {
  const router = useRouter();
  // Navigating before the root navigator is mounted throws, and a share can open the app cold.
  const navigationReady = Boolean(useRootNavigationState()?.key);
  const { hasShareIntent, shareIntent, resetShareIntent } =
    useShareIntentContext();

  useEffect(() => {
    if (!hasShareIntent || !navigationReady) return;
    const shared = shareIntent.webUrl ?? shareIntent.text;
    resetShareIntent();
    if (shared) router.navigate({ pathname: '/add', params: { url: shared } });
  }, [hasShareIntent, navigationReady, shareIntent, resetShareIntent, router]);

  return null;
}
