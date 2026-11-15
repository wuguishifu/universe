import {
  type EventSubscription,
  type NativeModule,
  requireOptionalNativeModule,
} from 'expo-modules-core';

/** A machine the app has logged in to. Its password, if any, is in the Keychain behind Face ID. */
export type SshProfile = {
  /** `user@host:port` */
  id: string;
  host: string;
  port: number;
  username: string;
  label: string;
  auth: 'password' | 'vaultKey';
  vaultKeyId?: string;
  vaultKeyName?: string;
  /** Epoch ms. */
  lastUsed?: number;
};

export type SshHostKey = {
  type: string;
  /** `SHA256:…` */
  fingerprint: string;
  /** This connection trusted the key for the first time. */
  isNew: boolean;
};

export type SshConnection = {
  sessionId: string;
  profile: SshProfile;
  hostKey: SshHostKey;
};

export type ConnectOptions = {
  /** A MagicDNS name or tailnet IP. */
  host: string;
  port: number;
  username: string;
  label?: string;
} & (
  | { password: string; vaultKeyId?: never; vaultKeyName?: never }
  | { vaultKeyId: string; vaultKeyName?: string; password?: never }
);

export type SshDataEvent = { sessionId: string; data: string };
export type SshCloseEvent = { sessionId: string; message?: string };

/** `error.code` values thrown by the native module. */
export const SshErrorCode = {
  /** Face ID was canceled or failed. */
  Canceled: 'ERR_SSH_CANCELED',
  CredentialsMissing: 'ERR_SSH_CREDENTIALS_MISSING',
  VaultLocked: 'ERR_SSH_VAULT_LOCKED',
  ProfileNotFound: 'ERR_SSH_PROFILE_NOT_FOUND',
  SessionNotFound: 'ERR_SSH_SESSION_NOT_FOUND',
  TailnetNotRunning: 'ERR_SSH_TAILNET_NOT_RUNNING',
  Unreachable: 'ERR_SSH_UNREACHABLE',
  AuthFailed: 'ERR_SSH_AUTH_FAILED',
  HostKeyChanged: 'ERR_SSH_HOST_KEY_CHANGED',
  InvalidKey: 'ERR_SSH_INVALID_KEY',
  KeyEncrypted: 'ERR_SSH_KEY_ENCRYPTED',
  Handshake: 'ERR_SSH_HANDSHAKE',
  Closed: 'ERR_SSH_CLOSED',
} as const;

type Events = {
  /** `data` is base64: chunks can split UTF-8 sequences, which only the terminal can reassemble. */
  onData(event: SshDataEvent): void;
  onClose(event: SshCloseEvent): void;
};

declare class NativeSapphireSsh extends NativeModule<Events> {
  listProfiles(): Promise<SshProfile[]>;
  deleteProfile(id: string): Promise<void>;
  connect(options: ConnectOptions): Promise<SshConnection>;
  connectProfile(id: string): Promise<SshConnection>;
  startShell(sessionId: string, cols: number, rows: number): Promise<void>;
  write(sessionId: string, text: string): void;
  resize(sessionId: string, cols: number, rows: number): void;
  close(sessionId: string): void;
  forgetHostKey(host: string, port: number): Promise<void>;
  pasteboardString(): Promise<string | null>;
}

const optional = requireOptionalNativeModule<NativeSapphireSsh>('SapphireSsh');

/** SSH is iOS only for now. Nothing else here works when this is false. */
export const isAvailable = optional !== null;

function native(): NativeSapphireSsh {
  if (!optional) {
    throw new Error('SSH is only available on iOS');
  }
  return optional;
}

export function listProfiles(): Promise<SshProfile[]> {
  return native().listProfiles();
}

/** Forgets the machine and its saved password. */
export function deleteProfile(id: string): Promise<void> {
  return native().deleteProfile(id);
}

/**
 * Logs in with new credentials and, once the server accepts them, saves the profile (and the
 * password, behind Face ID). A vault key prompts for Face ID to decrypt it.
 */
export function connect(options: ConnectOptions): Promise<SshConnection> {
  return native().connect(options);
}

/** Face ID, then logs in with the profile's saved password or vault key. */
export function connectProfile(id: string): Promise<SshConnection> {
  return native().connectProfile(id);
}

/** Starts the login shell. Subscribe to `onData` / `onClose` first. */
export function startShell(
  sessionId: string,
  cols: number,
  rows: number,
): Promise<void> {
  return native().startShell(sessionId, cols, rows);
}

export function write(sessionId: string, text: string) {
  native().write(sessionId, text);
}

export function resize(sessionId: string, cols: number, rows: number) {
  native().resize(sessionId, cols, rows);
}

export function close(sessionId: string) {
  native().close(sessionId);
}

/** Drops the remembered host key, so the next connection trusts the server's current one. */
export function forgetHostKey(host: string, port: number): Promise<void> {
  return native().forgetHostKey(host, port);
}

/** Reads the pasteboard; iOS asks the user first. */
export function pasteboardString(): Promise<string | null> {
  return native().pasteboardString();
}

export function addDataListener(
  listener: (event: SshDataEvent) => void,
): EventSubscription {
  return native().addListener('onData', listener);
}

export function addCloseListener(
  listener: (event: SshCloseEvent) => void,
): EventSubscription {
  return native().addListener('onClose', listener);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}
