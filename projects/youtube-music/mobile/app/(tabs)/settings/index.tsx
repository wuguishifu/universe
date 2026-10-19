import { useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { type ReactNode, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Button } from '../../../src/components/button';
import { confirm } from '../../../src/lib/action-sheet';
import { useConnection } from '../../../src/lib/api';
import { downloads, useDownloadSummary } from '../../../src/lib/downloads';
import { formatBytes } from '../../../src/lib/format';
import { player } from '../../../src/lib/player';
import { useServerStatus, useTracks } from '../../../src/lib/queries';
import { normalizeServerUrl, useSettings } from '../../../src/lib/settings';
import { colors, spacing } from '../../../src/theme';

export default function SettingsScreen() {
  const { settings, update, configured } = useSettings();
  const queryClient = useQueryClient();
  const connection = useConnection();
  const status = useServerStatus();
  const tracks = useTracks();
  const summary = useDownloadSummary();
  const [serverUrl, setServerUrl] = useState(settings.serverUrl);
  const [token, setToken] = useState(settings.token);

  const dirty =
    normalizeServerUrl(serverUrl) !== settings.serverUrl ||
    token.trim() !== settings.token;

  const save = () => {
    const nextUrl = normalizeServerUrl(serverUrl);
    if (nextUrl !== settings.serverUrl) {
      // A different server has a different library: none of what's cached or queued applies.
      player.stop();
      downloads.removeAll();
      queryClient.clear();
    }
    // BackgroundSync refetches everything with the new connection.
    update({ serverUrl: nextUrl, token: token.trim() });
    setServerUrl(nextUrl);
  };

  return (
    <ScrollView
      style={styles.screen}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: 'Settings' }} />

      <Section title="Server">
        <Field label="Address">
          <TextInput
            style={styles.input}
            value={serverUrl}
            onChangeText={setServerUrl}
            placeholder="http://my-server:3010"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
        </Field>
        <Field label="API token">
          <TextInput
            style={styles.input}
            value={token}
            onChangeText={setToken}
            placeholder="API_TOKEN from the server"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
        </Field>
        <Button
          label={dirty ? 'Save and connect' : 'Test connection'}
          onPress={dirty ? save : () => void status.refetch()}
          disabled={!serverUrl.trim() || !token.trim()}
        />
        {configured && !dirty && (
          <View style={styles.status}>
            {status.isFetching ? (
              <ActivityIndicator color={colors.textMuted} size="small" />
            ) : status.error ? (
              <Text style={styles.error}>{status.error.message}</Text>
            ) : status.data ? (
              <>
                <Text style={styles.ok}>Connected</Text>
                <Text style={styles.detail}>
                  yt-dlp {status.data.ytdlpVersion ?? 'not found'} ·{' '}
                  {status.data.queue.active + status.data.queue.waiting}{' '}
                  downloading
                  {status.data.queue.failed
                    ? ` · ${status.data.queue.failed} failed`
                    : ''}
                </Text>
              </>
            ) : null}
          </View>
        )}
      </Section>

      <Section title="Playback">
        <Toggle
          label="Even out volume"
          description="Turns loud songs down so everything plays at about the same loudness."
          value={settings.normalizeVolume}
          onChange={(normalizeVolume) => update({ normalizeVolume })}
        />
      </Section>

      <Section title="Downloads">
        <Toggle
          label="Keep everything on this phone"
          description="Downloads every song in your library as it's ready, so it all plays offline."
          value={settings.autoDownload}
          onChange={(autoDownload) => update({ autoDownload })}
        />
        <Text style={styles.detail}>
          {summary.count} {summary.count === 1 ? 'song' : 'songs'} on this
          phone, {formatBytes(summary.bytes)}
          {summary.inProgress ? ` · ${summary.inProgress} downloading` : ''}
        </Text>
        <Button
          label="Download whole library now"
          icon="cloud-download-outline"
          variant="secondary"
          disabled={!tracks.data?.length}
          onPress={() => downloads.download(tracks.data ?? [], connection)}
        />
        <Button
          label="Remove all downloads"
          icon="trash-outline"
          variant="danger"
          disabled={summary.count === 0 && summary.inProgress === 0}
          onPress={() =>
            confirm(
              'Remove all downloads?',
              'Songs stay in your library and stream from the server.',
              'Remove',
              () => downloads.removeAll(),
            )
          }
        />
      </Section>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

function Toggle({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.toggle}>
      <View style={styles.toggleText}>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Text style={styles.detail}>{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.accent, false: colors.border }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  section: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    gap: spacing.sm,
  },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionBody: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.lg,
    gap: spacing.md,
  },
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
  status: { gap: 2 },
  ok: { color: colors.success, fontSize: 15, fontWeight: '600' },
  error: { color: colors.danger, fontSize: 14 },
  detail: { color: colors.textMuted, fontSize: 13 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  toggleText: { flex: 1, gap: 2 },
  toggleLabel: { color: colors.text, fontSize: 16 },
});
