import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { PromptModal } from '../src/components/prompt-modal';
import {
  useAddToPlaylist,
  useCreatePlaylist,
  usePlaylists,
} from '../src/lib/queries';
import { colors, spacing } from '../src/theme';

/** Picks a playlist (or makes one) for `trackIds`, a comma-separated list. */
export default function AddToPlaylistScreen() {
  const router = useRouter();
  const { trackIds: param } = useLocalSearchParams<{ trackIds: string }>();
  const trackIds = (param ?? '')
    .split(',')
    .map(Number)
    .filter(Number.isInteger);
  const { data } = usePlaylists();
  const addToPlaylist = useAddToPlaylist();
  const createPlaylist = useCreatePlaylist();
  const [creating, setCreating] = useState(false);

  const add = (id: number) =>
    addToPlaylist.mutate({ id, trackIds }, { onSuccess: () => router.back() });

  return (
    <View style={styles.screen}>
      <FlatList
        data={data ?? []}
        keyExtractor={(p) => String(p.id)}
        ListHeaderComponent={
          <Row
            icon="add-circle"
            label="New playlist…"
            accent
            onPress={() => setCreating(true)}
          />
        }
        renderItem={({ item }) => {
          const already = trackIds.every((id) => item.trackIds.includes(id));
          return (
            <Row
              icon={already ? 'checkmark-circle' : 'list'}
              label={item.name}
              detail={
                already ? 'Already in it' : `${item.trackIds.length} songs`
              }
              disabled={already || addToPlaylist.isPending}
              onPress={() => add(item.id)}
            />
          );
        }}
      />
      <PromptModal
        visible={creating}
        title="New playlist"
        placeholder="Name"
        submitLabel="Create"
        onCancel={() => setCreating(false)}
        onSubmit={(name) => {
          setCreating(false);
          createPlaylist.mutate(name, {
            onSuccess: (playlist) => add(playlist.id),
          });
        }}
      />
    </View>
  );
}

function Row({
  icon,
  label,
  detail,
  accent,
  disabled,
  onPress,
}: {
  icon: 'add-circle' | 'checkmark-circle' | 'list';
  label: string;
  detail?: string;
  accent?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.row,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Ionicons
        name={icon}
        size={24}
        color={accent ? colors.accent : colors.textMuted}
      />
      <Text style={[styles.label, accent && styles.accent]} numberOfLines={1}>
        {label}
      </Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  pressed: { backgroundColor: colors.surfaceRaised },
  disabled: { opacity: 0.5 },
  label: { flex: 1, color: colors.text, fontSize: 16 },
  accent: { color: colors.accent, fontWeight: '600' },
  detail: { color: colors.textMuted, fontSize: 13 },
});
