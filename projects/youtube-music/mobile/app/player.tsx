import Ionicons from '@expo/vector-icons/Ionicons';
import Slider from '@react-native-community/slider';
import { useAudioPlaylistStatus } from 'expo-audio';
import { useRouter } from 'expo-router';
import { type ComponentProps, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Artwork } from '../src/components/artwork';
import { formatDuration, trackArtist, trackTitle } from '../src/lib/format';
import { player, usePlayer } from '../src/lib/player';
import { useTrackActions } from '../src/lib/track-actions';
import { colors, spacing } from '../src/theme';

export default function PlayerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { queue, index, shuffle, repeat, context } = usePlayer();
  const status = useAudioPlaylistStatus(player.playlist);
  const openActions = useTrackActions();
  const [showQueue, setShowQueue] = useState(false);
  /** Where the thumb is while it's being dragged, so status updates don't yank it back. */
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  const track = queue[index];

  const header = (
    <View style={styles.topBar}>
      <Pressable onPress={() => router.back()} hitSlop={12}>
        <Ionicons name="chevron-down" size={28} color={colors.text} />
      </Pressable>
      <Text style={styles.context} numberOfLines={1}>
        {context ? `Playing from ${context}` : 'Now playing'}
      </Text>
      <Pressable onPress={() => setShowQueue((s) => !s)} hitSlop={12}>
        <Ionicons
          name="list"
          size={24}
          color={showQueue ? colors.accent : colors.text}
        />
      </Pressable>
    </View>
  );

  if (!track) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + spacing.sm }]}>
        {header}
        <Text style={styles.nothing}>Nothing's playing.</Text>
      </View>
    );
  }

  const duration = status.duration || track.durationSec || 0;
  const position = scrubbing ?? status.currentTime;
  const artSize = Math.min(width - spacing.xl * 2, 360);

  return (
    <View
      style={[
        styles.screen,
        {
          paddingTop: insets.top + spacing.sm,
          paddingBottom: insets.bottom + spacing.lg,
        },
      ]}
    >
      {header}

      {showQueue ? (
        <FlatList
          style={styles.queue}
          data={queue}
          keyExtractor={(t, i) => `${t.id}-${i}`}
          initialScrollIndex={Math.max(0, index)}
          getItemLayout={(_, i) => ({ length: 60, offset: 60 * i, index: i })}
          renderItem={({ item, index: i }) => (
            <Pressable
              style={[styles.queueRow, i < index && styles.played]}
              onPress={() => player.jumpTo(i)}
            >
              <Artwork track={item} size={44} radius={4} />
              <View style={styles.queueText}>
                <Text
                  style={[styles.queueTitle, i === index && styles.current]}
                  numberOfLines={1}
                >
                  {trackTitle(item)}
                </Text>
                <Text style={styles.queueArtist} numberOfLines={1}>
                  {trackArtist(item)}
                </Text>
              </View>
              {i > index && (
                <Pressable
                  hitSlop={10}
                  onPress={() => player.removeFromQueue(i)}
                >
                  <Ionicons name="close" size={20} color={colors.textMuted} />
                </Pressable>
              )}
            </Pressable>
          )}
        />
      ) : (
        <View style={styles.artwork}>
          <Artwork track={track} size={artSize} radius={12} />
        </View>
      )}

      <View style={styles.info}>
        <View style={styles.infoText}>
          <Text style={styles.title} numberOfLines={2}>
            {trackTitle(track)}
          </Text>
          <Text style={styles.artist} numberOfLines={1}>
            {trackArtist(track)}
          </Text>
        </View>
        <Pressable onPress={() => openActions(track)} hitSlop={12}>
          <Ionicons name="ellipsis-horizontal" size={24} color={colors.text} />
        </Pressable>
      </View>

      <View>
        <Slider
          value={position}
          minimumValue={0}
          maximumValue={Math.max(duration, 1)}
          minimumTrackTintColor={colors.accent}
          maximumTrackTintColor={colors.border}
          thumbTintColor={colors.text}
          onValueChange={setScrubbing}
          onSlidingComplete={(value) => {
            player.seek(value);
            setScrubbing(null);
          }}
        />
        <View style={styles.times}>
          <Text style={styles.time}>{formatDuration(position)}</Text>
          <Text style={styles.time}>
            -{formatDuration(Math.max(0, duration - position))}
          </Text>
        </View>
      </View>

      <View style={styles.controls}>
        <Control
          icon="shuffle"
          size={24}
          active={shuffle}
          onPress={() => player.setShuffle(!shuffle)}
        />
        <Control
          icon="play-skip-back"
          size={34}
          onPress={() => player.previous()}
        />
        <Pressable style={styles.playButton} onPress={() => player.toggle()}>
          <Ionicons
            name={status.playing ? 'pause' : 'play'}
            size={38}
            color={colors.background}
            style={status.playing ? undefined : styles.playIcon}
          />
        </Pressable>
        <Control
          icon="play-skip-forward"
          size={34}
          onPress={() => player.next()}
        />
        <View>
          <Control
            icon="repeat"
            size={24}
            active={repeat !== 'off'}
            onPress={() => player.cycleRepeat()}
          />
          {repeat === 'one' && <Text style={styles.repeatOne}>1</Text>}
        </View>
      </View>
    </View>
  );
}

function Control({
  icon,
  size,
  active,
  onPress,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  size: number;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} hitSlop={12}>
      <Ionicons
        name={icon}
        size={size}
        color={
          active === false
            ? colors.textMuted
            : active
              ? colors.accent
              : colors.text
        }
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.xl,
    gap: spacing.lg,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  context: {
    flex: 1,
    textAlign: 'center',
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  nothing: { color: colors.textMuted, textAlign: 'center', marginTop: 80 },
  artwork: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  queue: { flex: 1, marginHorizontal: -spacing.xl },
  queueRow: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  played: { opacity: 0.45 },
  queueText: { flex: 1 },
  queueTitle: { color: colors.text, fontSize: 15 },
  current: { color: colors.accent, fontWeight: '600' },
  queueArtist: { color: colors.textMuted, fontSize: 13 },
  info: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  infoText: { flex: 1, gap: 4 },
  title: { color: colors.text, fontSize: 22, fontWeight: '700' },
  artist: { color: colors.textMuted, fontSize: 17 },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  time: {
    color: colors.textMuted,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
  },
  playButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIcon: { marginLeft: 4 },
  repeatOne: {
    position: 'absolute',
    right: -6,
    top: -6,
    color: colors.accent,
    fontSize: 10,
    fontWeight: '800',
  },
});
