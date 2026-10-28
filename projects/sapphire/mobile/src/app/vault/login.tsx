import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import * as SapphireVault from '@projects/sapphire-vault';

import { useTailnet } from '../../modules/tailnet/tailnet-provider';
import { useColors } from '../../modules/theme';
import { Button, vaultStyles } from '../../modules/vault/ui';
import { useVault } from '../../modules/vault/vault-provider';

export default function VaultLoginScreen() {
  const colors = useColors();
  const tailnet = useTailnet();
  const { state, login } = useVault();

  const [serverUrl, setServerUrl] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  // Prefill once the native state has loaded (the current account, or the last server used).
  const [prefilled, setPrefilled] = useState(false);
  useEffect(() => {
    if (state && !prefilled) {
      setServerUrl(state.serverUrl);
      setEmail(state.email ?? '');
      setPrefilled(true);
    }
  }, [state, prefilled]);

  const running =
    tailnet.phase === 'started' && tailnet.status?.backendState === 'Running';

  const reason = !state?.loggedIn
    ? undefined
    : !state.keyAvailable
      ? 'Face ID changed, so the vault key was erased. Enter your master password to set it up again.'
      : state.needsReauth
        ? 'The session expired. Enter your master password to keep syncing.'
        : undefined;

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await login(serverUrl, email, password);
      setPassword('');
      // Back to the vault screen if it's underneath (the "session expired" banner), else replace.
      router.dismissTo('/vault');
    } catch (e) {
      setError(SapphireVault.errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView
      edges={['top', 'bottom']}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScrollView
        contentContainerStyle={vaultStyles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[vaultStyles.title, { color: colors.text }]}>
          Log in to vault
        </Text>
        {reason && <Text style={{ color: colors.danger }}>{reason}</Text>}
        {!running && (
          <Text style={{ color: colors.muted }}>
            Waiting for the tailnet to connect…
          </Text>
        )}

        <Text style={[vaultStyles.sectionTitle, { color: colors.muted }]}>
          SERVER
        </Text>
        <View style={[vaultStyles.card, { backgroundColor: colors.card }]}>
          <TextInput
            value={serverUrl}
            onChangeText={setServerUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            textContentType="URL"
            placeholder="https://vault.example.com"
            placeholderTextColor={colors.muted}
            style={[vaultStyles.input, { color: colors.text }]}
          />
        </View>

        <Text style={[vaultStyles.sectionTitle, { color: colors.muted }]}>
          ACCOUNT
        </Text>
        <View style={[vaultStyles.card, { backgroundColor: colors.card }]}>
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="username"
            placeholder="Email"
            placeholderTextColor={colors.muted}
            style={[vaultStyles.input, { color: colors.text }]}
          />
          <View style={[vaultStyles.divider, { borderColor: colors.border }]} />
          <TextInput
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={submit}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="password"
            returnKeyType="go"
            placeholder="Master password"
            placeholderTextColor={colors.muted}
            style={[vaultStyles.input, { color: colors.text }]}
          />
        </View>

        {error && <Text style={{ color: colors.danger }}>{error}</Text>}
        {busy ? (
          <ActivityIndicator
            style={{ alignSelf: 'flex-start', marginTop: 8 }}
          />
        ) : (
          <Button
            label="Log in"
            onPress={submit}
            disabled={!running || !serverUrl || !email || !password}
          />
        )}
        <Text style={[vaultStyles.small, { color: colors.muted }]}>
          The master password is only used to log in. After that, Face ID
          unlocks the vault.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
