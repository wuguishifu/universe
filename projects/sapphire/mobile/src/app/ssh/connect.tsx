import { useLocalSearchParams } from 'expo-router';
import { Check, KeyRound } from 'lucide-react-native';
import { type ComponentProps, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import * as SapphireSsh from '@projects/sapphire-ssh';
import * as SapphireVault from '@projects/sapphire-vault';

import { connectAndOpen } from '../../modules/ssh/connect';
import { useColors } from '../../modules/theme';
import { Button, vaultStyles } from '../../modules/vault/ui';
import { useVault } from '../../modules/vault/vault-provider';

type Auth = 'password' | 'vaultKey';

export default function SshConnectScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{
    host?: string;
    port?: string;
    username?: string;
    label?: string;
  }>();
  const { state: vaultState } = useVault();
  const vaultUsable =
    SapphireVault.isAvailable &&
    !!vaultState?.loggedIn &&
    vaultState.keyAvailable;

  const [host, setHost] = useState(params.host ?? '');
  const [port, setPort] = useState(params.port ?? '22');
  const [username, setUsername] = useState(params.username ?? '');
  const [label, setLabel] = useState(params.label ?? '');
  const [auth, setAuth] = useState<Auth>('password');
  const [password, setPassword] = useState('');
  const [keys, setKeys] = useState<SapphireVault.VaultSshKey[]>();
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [key, setKey] = useState<SapphireVault.VaultSshKey>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  // Most machines get the same user; start from the one used last.
  useEffect(() => {
    if (params.username) {
      return;
    }
    void SapphireSsh.listProfiles().then((profiles) => {
      const last = [...profiles].sort(
        (a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0),
      )[0];
      if (last) {
        setUsername((current) => current || last.username);
      }
    });
  }, [params.username]);

  const loadKeys = async () => {
    setLoadingKeys(true);
    setError(undefined);
    try {
      const loaded = await SapphireVault.sshKeys();
      setKeys(loaded.sort((a, b) => a.name.localeCompare(b.name)));
      if (loaded.length === 1) {
        setKey(loaded[0]);
      }
    } catch (e) {
      if (
        SapphireVault.errorCode(e) !== SapphireVault.VaultErrorCode.UserCanceled
      ) {
        setError(SapphireVault.errorMessage(e));
      }
    } finally {
      setLoadingKeys(false);
    }
  };

  const portNumber = Number(port);
  const valid =
    host.trim() !== '' &&
    username.trim() !== '' &&
    Number.isInteger(portNumber) &&
    portNumber > 0 &&
    portNumber < 65536 &&
    (auth === 'password' ? password !== '' : key !== undefined);

  const submit = async () => {
    if (!valid || busy) {
      return;
    }
    setBusy(true);
    setError(undefined);
    const target = {
      host: host.trim(),
      port: portNumber,
      username: username.trim(),
      label: label.trim() || undefined,
    };
    try {
      await connectAndOpen(
        () =>
          SapphireSsh.connect(
            auth === 'vaultKey' && key
              ? { ...target, vaultKeyId: key.id, vaultKeyName: key.name }
              : { ...target, password },
          ),
        target,
        { replace: true },
      );
    } catch (e) {
      setError(SapphireSsh.errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const field = (
    title: string,
    input: ComponentProps<typeof TextInput>,
    first = false,
  ) => (
    <View
      style={[
        styles.field,
        !first && [vaultStyles.divider, { borderColor: colors.border }],
      ]}
    >
      <Text style={[styles.fieldTitle, { color: colors.muted }]}>{title}</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        placeholderTextColor={colors.muted}
        editable={!busy}
        style={[vaultStyles.input, styles.fieldInput, { color: colors.text }]}
        {...input}
      />
    </View>
  );

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
          {params.label ?? 'New connection'}
        </Text>

        <View style={[vaultStyles.card, { backgroundColor: colors.card }]}>
          {field(
            'Host',
            {
              value: host,
              onChangeText: setHost,
              placeholder: 'sol or sol.tailnet.ts.net',
              keyboardType: 'url',
            },
            true,
          )}
          {field('Port', {
            value: port,
            onChangeText: setPort,
            keyboardType: 'number-pad',
          })}
          {field('User', {
            value: username,
            onChangeText: setUsername,
            placeholder: 'root',
            textContentType: 'username',
          })}
          {field('Name', {
            value: label,
            onChangeText: setLabel,
            placeholder: host || 'Shown in the list',
          })}
        </View>

        <View style={[styles.segments, { backgroundColor: colors.card }]}>
          {(['password', 'vaultKey'] as const).map((option) => (
            <Pressable
              key={option}
              disabled={busy || (option === 'vaultKey' && !vaultUsable)}
              onPress={() => {
                setAuth(option);
                if (option === 'vaultKey' && !keys) {
                  void loadKeys();
                }
              }}
              style={[
                styles.segment,
                auth === option && { backgroundColor: colors.accent },
                option === 'vaultKey' && !vaultUsable && { opacity: 0.4 },
              ]}
            >
              <Text
                style={{ color: auth === option ? '#ffffff' : colors.text }}
              >
                {option === 'password' ? 'Password' : 'SSH key from vault'}
              </Text>
            </Pressable>
          ))}
        </View>

        {auth === 'password' ? (
          <>
            <View style={[vaultStyles.card, { backgroundColor: colors.card }]}>
              {field(
                'Password',
                {
                  value: password,
                  onChangeText: setPassword,
                  secureTextEntry: true,
                  textContentType: 'password',
                  returnKeyType: 'go',
                  onSubmitEditing: submit,
                },
                true,
              )}
            </View>
            <Text style={[styles.footnote, { color: colors.muted }]}>
              Once the login works, the password is saved on this iPhone behind
              Face ID, so next time it's one tap.
            </Text>
          </>
        ) : (
          <View style={[vaultStyles.card, { backgroundColor: colors.card }]}>
            {loadingKeys ? (
              <ActivityIndicator style={{ alignSelf: 'flex-start' }} />
            ) : keys === undefined ? (
              <Button
                label="Unlock vault keys with Face ID"
                onPress={loadKeys}
              />
            ) : keys.length === 0 ? (
              <Text style={{ color: colors.muted }}>
                No SSH keys in the vault. Add one in Bitwarden (New item → SSH
                key), then sync.
              </Text>
            ) : (
              keys.map((item, i) => (
                <Pressable
                  key={item.id}
                  onPress={() => setKey(item)}
                  style={[
                    styles.keyRow,
                    i > 0 && [
                      vaultStyles.divider,
                      { borderColor: colors.border },
                    ],
                  ]}
                >
                  <KeyRound size={18} color={colors.muted} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text }}>{item.name}</Text>
                    {item.fingerprint && (
                      <Text
                        numberOfLines={1}
                        style={[
                          vaultStyles.small,
                          vaultStyles.mono,
                          { color: colors.muted },
                        ]}
                      >
                        {item.fingerprint}
                      </Text>
                    )}
                  </View>
                  {key?.id === item.id && (
                    <Check size={18} color={colors.accent} />
                  )}
                </Pressable>
              ))
            )}
          </View>
        )}

        {error && (
          <Text style={{ color: colors.danger, marginHorizontal: 16 }}>
            {error}
          </Text>
        )}

        {busy ? (
          <ActivityIndicator style={{ marginTop: 8 }} />
        ) : (
          <View style={{ alignItems: 'center' }}>
            <Button label="Connect" onPress={submit} disabled={!valid} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  fieldTitle: {
    width: 72,
  },
  fieldInput: {
    flex: 1,
  },
  segments: {
    flexDirection: 'row',
    borderRadius: 10,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 7,
  },
  keyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  footnote: {
    fontSize: 12,
    marginHorizontal: 16,
  },
});
