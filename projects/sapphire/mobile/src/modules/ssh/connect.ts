import { router } from 'expo-router';
import { Alert } from 'react-native';

import * as SapphireSsh from '@projects/sapphire-ssh';

/** What the session screen needs, as route params (strings only; nothing secret). */
export type SessionParams = {
  sessionId: string;
  profileId: string;
  label: string;
  /** Shown dimmed above the login banner when the host key was trusted for the first time. */
  hostKeyNote?: string;
};

/**
 * Runs a connect attempt and opens the terminal. A canceled Face ID prompt resolves null; a
 * changed host key asks whether to trust the new one and retries. Other failures throw.
 */
export async function connectAndOpen(
  attempt: () => Promise<SapphireSsh.SshConnection>,
  target: { host: string; port: number },
  { replace = false }: { replace?: boolean } = {},
): Promise<SapphireSsh.SshConnection | null> {
  const connection = await connectTrustingChangedKeys(attempt, target);
  if (!connection) {
    return null;
  }
  const note = hostKeyNote(connection);
  const params: SessionParams = {
    sessionId: connection.sessionId,
    profileId: connection.profile.id,
    label: connection.profile.label,
    ...(note && { hostKeyNote: note }),
  };
  const navigate = replace ? router.replace : router.push;
  navigate({ pathname: '/ssh/session', params });
  return connection;
}

/** The same, without navigating: for reconnecting from the terminal itself. */
export async function connectTrustingChangedKeys(
  attempt: () => Promise<SapphireSsh.SshConnection>,
  target: { host: string; port: number },
): Promise<SapphireSsh.SshConnection | null> {
  try {
    return await attempt();
  } catch (error) {
    const code = SapphireSsh.errorCode(error);
    if (code === SapphireSsh.SshErrorCode.Canceled) {
      return null;
    }
    if (code !== SapphireSsh.SshErrorCode.HostKeyChanged) {
      throw error;
    }
    if (!(await confirmNewHostKey(SapphireSsh.errorMessage(error)))) {
      return null;
    }
    await SapphireSsh.forgetHostKey(target.host, target.port);
    return attempt();
  }
}

export function hostKeyNote({
  hostKey,
}: SapphireSsh.SshConnection): string | undefined {
  return hostKey.isNew
    ? `Trusted new ${hostKey.type} host key ${hostKey.fingerprint}`
    : undefined;
}

function confirmNewHostKey(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      'Host key changed',
      `${message}.\n\nThat's expected if the machine was reinstalled or its SSH keys were regenerated. Otherwise, something may be impersonating it.`,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        {
          text: 'Trust new key',
          style: 'destructive',
          onPress: () => resolve(true),
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
