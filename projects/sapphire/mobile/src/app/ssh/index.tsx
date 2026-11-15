import { router, useFocusEffect } from 'expo-router';
import { KeyRound, Plus, ScanFace } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import * as SapphireSsh from '@projects/sapphire-ssh';

import { connectAndOpen } from '../../modules/ssh/connect';
import { useTailnet } from '../../modules/tailnet/tailnet-provider';
import { useColors } from '../../modules/theme';
import { showError, vaultStyles } from '../../modules/vault/ui';

export default function SshScreen() {
  const colors = useColors();
  const tailnet = useTailnet();
  const [profiles, setProfiles] = useState<SapphireSsh.SshProfile[]>();
  const [connecting, setConnecting] = useState<string>();

  const refresh = useCallback(() => {
    SapphireSsh.listProfiles().then(setProfiles, (error) =>
      showError("Couldn't load saved machines", error),
    );
  }, []);
  // Coming back from a session or the login form may have added or touched a profile.
  useFocusEffect(refresh);

  const running =
    tailnet.phase === 'started' && tailnet.status?.backendState === 'Running';
  const peers = [...(running ? (tailnet.status?.peers ?? []) : [])].sort(
    (a, b) =>
      Number(b.online) - Number(a.online) ||
      a.hostName.localeCompare(b.hostName),
  );
  const saved = [...(profiles ?? [])].sort(
    (a, b) =>
      (b.lastUsed ?? 0) - (a.lastUsed ?? 0) || a.label.localeCompare(b.label),
  );

  const connect = async (profile: SapphireSsh.SshProfile) => {
    setConnecting(profile.id);
    try {
      await connectAndOpen(
        () => SapphireSsh.connectProfile(profile.id),
        profile,
      );
    } catch (error) {
      handleSavedLoginError(profile, error);
    } finally {
      setConnecting(undefined);
    }
  };

  const manage = (profile: SapphireSsh.SshProfile) => {
    Alert.alert(profile.label, `${profile.username}@${profile.host}`, [
      { text: 'Log in differently', onPress: () => openForm(profile) },
      {
        text: 'Forget',
        style: 'destructive',
        onPress: () =>
          void SapphireSsh.deleteProfile(profile.id).then(refresh, (error) =>
            showError("Couldn't forget it", error),
          ),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <SafeAreaView
      edges={['top', 'bottom']}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScrollView contentContainerStyle={vaultStyles.content}>
        <Text style={[vaultStyles.title, { color: colors.text }]}>SSH</Text>

        {!running && (
          <Pressable
            onPress={() => router.push('/tailnet')}
            style={[vaultStyles.card, { backgroundColor: colors.card }]}
          >
            <Text style={{ color: colors.danger }}>
              The tailnet isn't running, so machines can't be reached.
            </Text>
            <Text style={{ color: colors.accent }}>Open Tailnet ›</Text>
          </Pressable>
        )}

        {saved.length > 0 && (
          <>
            <Text style={[vaultStyles.sectionTitle, { color: colors.muted }]}>
              SAVED
            </Text>
            <View style={[vaultStyles.card, { backgroundColor: colors.card }]}>
              {saved.map((profile, i) => (
                <Pressable
                  key={profile.id}
                  onPress={() => void connect(profile)}
                  onLongPress={() => manage(profile)}
                  disabled={connecting !== undefined || !running}
                  style={({ pressed }) => [
                    styles.row,
                    i > 0 && [
                      vaultStyles.divider,
                      { borderColor: colors.border },
                    ],
                    { opacity: pressed || !running ? 0.5 : 1 },
                  ]}
                >
                  {profile.auth === 'vaultKey' ? (
                    <KeyRound size={18} color={colors.muted} />
                  ) : (
                    <ScanFace size={18} color={colors.muted} />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text }}>{profile.label}</Text>
                    <Text
                      numberOfLines={1}
                      style={[vaultStyles.small, { color: colors.muted }]}
                    >
                      {profile.username}@{profile.host}
                      {profile.port === 22 ? '' : `:${profile.port}`}
                      {profile.vaultKeyName ? ` · ${profile.vaultKeyName}` : ''}
                    </Text>
                  </View>
                  {connecting === profile.id ? (
                    <ActivityIndicator />
                  ) : (
                    <Text style={{ color: colors.muted }}>›</Text>
                  )}
                </Pressable>
              ))}
            </View>
            <Text style={[styles.footnote, { color: colors.muted }]}>
              Tap to connect with Face ID. Long-press for more.
            </Text>
          </>
        )}

        <Text style={[vaultStyles.sectionTitle, { color: colors.muted }]}>
          MACHINES
        </Text>
        <View style={[vaultStyles.card, { backgroundColor: colors.card }]}>
          {peers.map((peer, i) => (
            <Pressable
              key={peer.dnsName || peer.hostName}
              onPress={() =>
                openForm({
                  host: peer.dnsName || peer.ips[0] || peer.hostName,
                  label: peer.hostName,
                })
              }
              style={({ pressed }) => [
                styles.row,
                i > 0 && [vaultStyles.divider, { borderColor: colors.border }],
                { opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <View
                style={[
                  styles.dot,
                  {
                    backgroundColor: peer.online
                      ? colors.success
                      : colors.border,
                  },
                ]}
              />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text }}>{peer.hostName}</Text>
                <Text style={[vaultStyles.small, { color: colors.muted }]}>
                  {peer.ips[0]} · {peer.os}
                </Text>
              </View>
              <Text style={{ color: colors.muted }}>›</Text>
            </Pressable>
          ))}
          <Pressable
            onPress={() => openForm({})}
            style={({ pressed }) => [
              styles.row,
              peers.length > 0 && [
                vaultStyles.divider,
                { borderColor: colors.border },
              ],
              { opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <Plus size={18} color={colors.accent} />
            <Text style={{ color: colors.accent }}>Other host</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

type FormParams = Partial<
  Pick<SapphireSsh.SshProfile, 'host' | 'port' | 'username' | 'label'>
>;

function openForm({ host, port, username, label }: FormParams) {
  router.push({
    pathname: '/ssh/connect',
    params: {
      ...(host && { host }),
      ...(port && { port: String(port) }),
      ...(username && { username }),
      ...(label && { label }),
    },
  });
}

function handleSavedLoginError(
  profile: SapphireSsh.SshProfile,
  error: unknown,
) {
  const code = SapphireSsh.errorCode(error);
  if (
    code === SapphireSsh.SshErrorCode.AuthFailed ||
    code === SapphireSsh.SshErrorCode.CredentialsMissing
  ) {
    Alert.alert("Couldn't log in", SapphireSsh.errorMessage(error), [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log in again', onPress: () => openForm(profile) },
    ]);
  } else if (code === SapphireSsh.SshErrorCode.VaultLocked) {
    Alert.alert('Vault locked', SapphireSsh.errorMessage(error), [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Open vault', onPress: () => router.push('/vault') },
    ]);
  } else {
    showError("Couldn't connect", error);
  }
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  footnote: {
    fontSize: 12,
    marginLeft: 16,
  },
});
