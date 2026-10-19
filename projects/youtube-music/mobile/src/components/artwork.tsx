import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import type { Track } from '@projects/youtube-music-contracts';
import { artworkUrl, authHeaders, useConnection } from '../lib/api';
import { useDownloadState, downloads } from '../lib/downloads';
import { colors } from '../theme';

/** A track's square artwork: the downloaded copy if there is one, the server's otherwise. */
export function Artwork({
  track,
  size,
  radius = 6,
}: {
  track: Pick<Track, 'id' | 'hasArtwork'> | undefined;
  size: number;
  radius?: number;
}) {
  const connection = useConnection();
  // Re-renders when the track finishes downloading, to switch to the local file.
  const downloaded = useDownloadState(track?.id ?? -1)?.status === 'downloaded';
  const box = { width: size, height: size, borderRadius: radius };

  if (!track?.hasArtwork) {
    return (
      <View style={[styles.placeholder, box]}>
        <Ionicons
          name="musical-notes"
          size={size * 0.42}
          color={colors.textFaint}
        />
      </View>
    );
  }

  const local = downloaded ? downloads.localArtworkUri(track.id) : null;
  return (
    <Image
      style={[styles.image, box]}
      source={
        local
          ? { uri: local }
          : {
              uri: artworkUrl(connection, track.id),
              headers: authHeaders(connection),
            }
      }
      cachePolicy="disk"
      recyclingKey={String(track.id)}
      transition={150}
    />
  );
}

const styles = StyleSheet.create({
  placeholder: {
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { backgroundColor: colors.surfaceRaised },
});
