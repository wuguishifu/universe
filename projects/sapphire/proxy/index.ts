import { requireNativeModule } from 'expo-modules-core';

type NativeSapphireProxy = {
  start(hostname: string): Promise<number>;
  stop(): Promise<void>;
  status(): Promise<string>;
  logout(): Promise<void>;
  logs(): string;
};

const native = requireNativeModule<NativeSapphireProxy>('SapphireProxy');

export type BackendState =
  | 'NoState'
  | 'NeedsLogin'
  | 'NeedsMachineAuth'
  | 'Stopped'
  | 'Starting'
  | 'Running';

export type TailnetPeer = {
  hostName: string;
  dnsName: string;
  os: string;
  ips: string[];
  online: boolean;
};

export type TailnetStatus = {
  backendState: BackendState;
  authURL?: string;
  self?: TailnetPeer;
  peers: TailnetPeer[];
  proxyPort?: number;
};

/**
 * Starts the embedded tailnet node and points every WebView in the app at its
 * local proxy. Resolves with the proxy port; login continues in the background.
 */
export function start(hostname: string): Promise<number> {
  return native.start(hostname);
}

export function stop(): Promise<void> {
  return native.stop();
}

export async function status(): Promise<TailnetStatus> {
  const parsed: TailnetStatus = JSON.parse(await native.status());
  return parsed;
}

export function logout(): Promise<void> {
  return native.logout();
}

export function logs(): string {
  return native.logs();
}
