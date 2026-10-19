import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '../../src/components/button';
import { EmptyState } from '../../src/components/empty-state';
import { useTracksById, useUpdateTrack } from '../../src/lib/queries';
import { colors, spacing } from '../../src/theme';

/** YouTube titles are often messy; this fixes up what shows in the app and on the lock screen. */
export default function EditTrackScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const track = useTracksById().get(Number(id));
  const updateTrack = useUpdateTrack();
  const [title, setTitle] = useState(track?.title ?? '');
  const [artist, setArtist] = useState(track?.artist ?? '');
  const [album, setAlbum] = useState(track?.album ?? '');

  if (!track)
    return <EmptyState icon="musical-note" title="This song is gone" />;

  const save = () =>
    updateTrack.mutate(
      {
        id: track.id,
        title: title.trim(),
        artist: artist.trim() || null,
        album: album.trim() || null,
      },
      { onSuccess: () => router.back() },
    );

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Field label="Title" value={title} onChange={setTitle} autoFocus />
      <Field label="Artist" value={artist} onChange={setArtist} />
      <Field label="Album" value={album} onChange={setAlbum} />
      <Button
        label="Save"
        onPress={save}
        loading={updateTrack.isPending}
        disabled={!title.trim()}
      />
    </ScrollView>
  );
}

function Field({
  label,
  value,
  onChange,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        autoFocus={autoFocus}
        placeholderTextColor={colors.textFaint}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { padding: spacing.lg, gap: spacing.lg },
  field: { gap: spacing.xs },
  label: { color: colors.textMuted, fontSize: 13 },
  input: {
    backgroundColor: colors.background,
    color: colors.text,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 16,
  },
});
