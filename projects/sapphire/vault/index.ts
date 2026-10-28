import { requireOptionalNativeModule } from 'expo-modules-core';

export type VaultState = {
  loggedIn: boolean;
  /** The account's server, or the last one used (or the default) when logged out. */
  serverUrl: string;
  email?: string;
  /** Epoch ms of the last successful sync. */
  lastSync?: number;
  /** The refresh token was rejected; the cache still works but sync needs the master password. */
  needsReauth: boolean;
  /** The Face ID protected key exists. False while logged in means Face ID changed. */
  keyAvailable: boolean;
};

/** Bitwarden's URI match detection: 0 base domain, 1 host, 2 starts with, 3 exact, 4 regex, 5 never. */
export type UriMatch = 0 | 1 | 2 | 3 | 4 | 5;

export type VaultItemSummary = {
  id: string;
  name: string;
  username?: string;
  uris: { uri: string; match?: UriMatch }[];
  favorite: boolean;
  hasTotp: boolean;
};

export type VaultItemSecret = {
  password?: string;
  /** The raw TOTP field; pass it to `totp` for the current code. */
  totp?: string;
};

export type TotpCode = { code: string; period: number; remaining: number };

export type SyncResult = {
  /** Epoch ms. */
  syncedAt: number;
  /** False when the server sent back exactly what was already cached. */
  changed: boolean;
};

/** `error.code` values thrown by the native module. */
export const VaultErrorCode = {
  NotLoggedIn: 'ERR_VAULT_NOT_LOGGED_IN',
  /** A login or logout happened while the sync was running, so its results were dropped. */
  AccountChanged: 'ERR_VAULT_ACCOUNT_CHANGED',
  ReauthRequired: 'ERR_VAULT_REAUTH_REQUIRED',
  KeyUnavailable: 'ERR_VAULT_KEY_UNAVAILABLE',
  UserCanceled: 'ERR_VAULT_USER_CANCELED',
  AuthenticationFailed: 'ERR_VAULT_AUTHENTICATION_FAILED',
  UnsupportedKdf: 'ERR_VAULT_UNSUPPORTED_KDF',
  TwoFactorUnsupported: 'ERR_VAULT_TWO_FACTOR_UNSUPPORTED',
  Server: 'ERR_VAULT_SERVER',
  Network: 'ERR_VAULT_NETWORK',
  InvalidResponse: 'ERR_VAULT_INVALID_RESPONSE',
  DecryptionFailed: 'ERR_VAULT_DECRYPTION_FAILED',
  InvalidTotp: 'ERR_VAULT_INVALID_TOTP',
  ItemNotFound: 'ERR_VAULT_ITEM_NOT_FOUND',
  Keychain: 'ERR_VAULT_KEYCHAIN',
  Misconfigured: 'ERR_VAULT_MISCONFIGURED',
} as const;

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

type NativeSapphireVault = {
  getState(): Promise<VaultState>;
  login(serverUrl: string, email: string, password: string): Promise<void>;
  sync(): Promise<SyncResult>;
  unlock(): Promise<VaultItemSummary[]>;
  reveal(id: string): Promise<VaultItemSecret>;
  copyPassword(id: string): Promise<void>;
  copyTotp(id: string): Promise<void>;
  totp(value: string): TotpCode;
  copy(text: string): Promise<void>;
  logout(): Promise<void>;
};

const optional =
  requireOptionalNativeModule<NativeSapphireVault>('SapphireVault');

/** The vault is iOS only. Nothing else here works when this is false. */
export const isAvailable = optional !== null;

function native(): NativeSapphireVault {
  if (!optional) {
    throw new Error('The vault is only available on iOS');
  }
  return optional;
}

export function getState(): Promise<VaultState> {
  return native().getState();
}

/**
 * Logs in with the master password over the tailnet and stores the Face ID protected key.
 * Doesn't sync; call `sync` after.
 */
export function login(
  serverUrl: string,
  email: string,
  password: string,
): Promise<void> {
  return native().login(serverUrl, email, password);
}

/** Refreshes the encrypted cache over the tailnet. */
export function sync(): Promise<SyncResult> {
  return native().sync();
}

/**
 * Face ID, then decrypts every item's summary and refreshes the AutoFill suggestions.
 * Passwords stay encrypted.
 */
export function unlock(): Promise<VaultItemSummary[]> {
  return native().unlock();
}

/** Face ID, then decrypts one item's password and TOTP secret. */
export function reveal(id: string): Promise<VaultItemSecret> {
  return native().reveal(id);
}

/** Face ID, then copies the password without it ever reaching JS. */
export function copyPassword(id: string): Promise<void> {
  return native().copyPassword(id);
}

/** Face ID, then copies the current TOTP code. */
export function copyTotp(id: string): Promise<void> {
  return native().copyTotp(id);
}

export function totp(value: string): TotpCode {
  return native().totp(value);
}

/** Copies to this device only, cleared after a minute. */
export function copy(text: string): Promise<void> {
  return native().copy(text);
}

export function logout(): Promise<void> {
  return native().logout();
}
