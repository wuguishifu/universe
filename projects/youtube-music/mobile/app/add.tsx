import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  findYoutubeLink,
  type ImportResult,
} from '@projects/youtube-music-contracts';
import { Artwork } from '../src/components/artwork';
import { Button } from '../src/components/button';
import { trackArtist, trackTitle } from '../src/lib/format';
import { useImport } from '../src/lib/queries';
import { useSettings } from '../src/lib/settings';
import { colors, spacing } from '../src/theme';

/**
 * Adds a YouTube video or playlist. Opened by the + button, or with `url` when a link is shared to
 * the app, in which case it's added straight away.
 */
export default function AddScreen() {
  const router = useRouter();
  const { url: sharedUrl } = useLocalSearchParams<{ url?: string }>();
  const { configured } = useSettings();
  const importLink = useImport();
  const [input, setInput] = useState(sharedUrl ?? '');
  const [result, setResult] = useState<ImportResult | null>(null);
  const submittedShare = useRef<string | null>(null);

  const submit = (text: string) => {
    setResult(null);
    importLink.mutate(text, { onSuccess: setResult });
  };

  useEffect(() => {
    if (!sharedUrl || !configured || submittedShare.current === sharedUrl)
      return;
    submittedShare.current = sharedUrl;
    setInput(sharedUrl);
    submit(sharedUrl);
    // Only when a new link is shared, not whenever `submit` changes.
  }, [sharedUrl, configured]);

  const link = findYoutubeLink(input);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {!configured ? (
        <Text style={styles.error}>
          Set up your server in Settings first, then share the link again.
        </Text>
      ) : (
        <>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={(text) => {
              setInput(text);
              setResult(null);
              importLink.reset();
            }}
            placeholder="Paste a YouTube video or playlist link"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            autoFocus={!sharedUrl}
            returnKeyType="go"
            onSubmitEditing={() => link && submit(input)}
          />
          {!result && (
            <Button
              label={
                link?.kind === 'playlist' ? 'Import playlist' : 'Add to library'
              }
              icon="add"
              loading={importLink.isPending}
              disabled={!link}
              onPress={() => submit(input)}
            />
          )}
          {input.trim() && !link ? (
            <Text style={styles.hint}>
              That doesn't look like a YouTube link.
            </Text>
          ) : null}
          {importLink.error ? (
            <Text style={styles.error}>{importLink.error.message}</Text>
          ) : null}
        </>
      )}

      {result?.kind === 'video' && (
        <View style={styles.card}>
          <View style={styles.cardRow}>
            <Artwork track={result.track} size={56} />
            <View style={styles.cardText}>
              <Text style={styles.title} numberOfLines={2}>
                {trackTitle(result.track)}
              </Text>
              {result.track.artist ? (
                <Text style={styles.subtitle}>{trackArtist(result.track)}</Text>
              ) : null}
            </View>
          </View>
          <Text style={styles.message}>
            <Ionicons
              name="checkmark-circle"
              color={colors.success}
              size={15}
            />{' '}
            {result.alreadyInLibrary
              ? result.track.status === 'ready'
                ? 'Already in your library.'
                : 'Already in your library, downloading on the server.'
              : 'Added. It shows up in your library once the server has downloaded it.'}
          </Text>
          <Button
            label="Add to playlist…"
            icon="list"
            variant="secondary"
            onPress={() =>
              router.push({
                pathname: '/add-to-playlist',
                params: { trackIds: String(result.track.id) },
              })
            }
          />
          <Button label="Done" onPress={() => router.back()} />
        </View>
      )}

      {result?.kind === 'playlist' && (
        <View style={styles.card}>
          <Text style={styles.title}>{result.playlist.name}</Text>
          <Text style={styles.message}>
            <Ionicons
              name="checkmark-circle"
              color={colors.success}
              size={15}
            />{' '}
            {result.playlist.trackIds.length} songs in the playlist
            {result.queued
              ? `, ${result.queued} new downloading on the server.`
              : '.'}
          </Text>
          <Button
            label="Open playlist"
            variant="secondary"
            onPress={() => {
              router.back();
              router.navigate({
                pathname: '/playlists/[id]',
                params: { id: result.playlist.id },
              });
            }}
          />
          <Button label="Done" onPress={() => router.back()} />
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { padding: spacing.lg, gap: spacing.md },
  input: {
    backgroundColor: colors.background,
    color: colors.text,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 16,
  },
  hint: { color: colors.textMuted, fontSize: 14 },
  error: { color: colors.danger, fontSize: 15 },
  card: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cardText: { flex: 1, gap: 2 },
  title: { color: colors.text, fontSize: 17, fontWeight: '600' },
  subtitle: { color: colors.textMuted, fontSize: 14 },
  message: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
});
