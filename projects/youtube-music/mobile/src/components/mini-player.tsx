import Ionicons from '@expo/vector-icons/Ionicons';
import { useAudioPlaylistStatus } from 'expo-audio';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { trackArtist, trackTitle } from '../lib/format';
import { player, useCurrentTrack } from '../lib/player';
import { colors, spacing } from '../theme';
import { Artwork } from './artwork';

/** Sits above the tab bar while something's queued. Tap it for the full player. */
export function MiniPlayer() {
  const router = useRouter();
  const track = useCurrentTrack();
  const status = useAudioPlaylistStatus(player.playlist);
  if (!track) return null;

  const progress =
    status.duration > 0 ? Math.min(1, status.currentTime / status.duration) : 0;
  return (
    <Pressable style={styles.container} onPress={() => router.push('/player')}>
      <View style={styles.row}>
        <Artwork track={track} size={40} radius={4} />
        <View style={styles.text}>
          <Text style={styles.title} numberOfLines={1}>
            {trackTitle(track)}
          </Text>
          <Text style={styles.artist} numberOfLines={1}>
            {trackArtist(track)}
          </Text>
        </View>
        <Pressable onPress={() => player.toggle()} hitSlop={10}>
          <Ionicons
            name={status.playing ? 'pause' : 'play'}
            size={28}
            color={colors.text}
          />
        </Pressable>
        <Pressable onPress={() => player.next()} hitSlop={10}>
          <Ionicons name="play-forward" size={24} color={colors.text} />
        </Pressable>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${progress * 100}%` }]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surfaceRaised,
    marginHorizontal: spacing.sm,
    marginBottom: spacing.xs,
    borderRadius: 10,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.sm,
    paddingRight: spacing.lg,
  },
  text: { flex: 1 },
  title: { color: colors.text, fontSize: 15, fontWeight: '600' },
  artist: { color: colors.textMuted, fontSize: 13 },
  track: { height: 2, backgroundColor: colors.border },
  fill: { height: 2, backgroundColor: colors.accent },
});
