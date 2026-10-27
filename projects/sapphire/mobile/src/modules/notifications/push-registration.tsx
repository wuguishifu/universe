import { useMutation } from 'convex/react';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AppState, Platform } from 'react-native';

import { api } from '@platform/convex-contracts';

import { env } from '../env';

import { type Channel, syncAndroidChannels } from './android-channels';

export type PushRegistration =
  | { status: 'pending' }
  /** A simulator or emulator, which can't get a push token. */
  | { status: 'unsupported' }
  | { status: 'denied' }
  | { status: 'registered'; expoPushToken: string }
  | { status: 'error'; message: string };

type PushRegistrationContextValue = {
  registration: PushRegistration;
  register: () => Promise<void>;
};

const PushRegistrationContext =
  createContext<PushRegistrationContextValue | null>(null);

/**
 * Registers this device's Expo push token in convex on launch, whenever the app comes back to the
 * foreground, and when the token changes. Registering again is cheap and keeps muted channels.
 *
 * On Android, `channels` have to exist before asking for permission (Android 13+ won't show the
 * prompt otherwise), so registration waits for them.
 */
export function PushRegistrationProvider({
  channels,
  children,
}: {
  channels: Channel[] | undefined;
  children: ReactNode;
}) {
  const registerDevice = useMutation(api.notifications.devices.register);
  const [registration, setRegistration] = useState<PushRegistration>({
    status: 'pending',
  });
  const inFlight = useRef<Promise<void> | null>(null);
  const ready = Platform.OS !== 'android' || channels !== undefined;

  const register = useCallback(() => {
    if (!ready) return Promise.resolve();
    // Foregrounding and a token change can land at the same time.
    inFlight.current ??= (async () => {
      try {
        if (!Device.isDevice) {
          setRegistration({ status: 'unsupported' });
          return;
        }
        await syncAndroidChannels(channels ?? []);

        let { status } = await Notifications.getPermissionsAsync();
        if (status !== 'granted') {
          ({ status } = await Notifications.requestPermissionsAsync());
        }
        if (status !== 'granted') {
          setRegistration({ status: 'denied' });
          return;
        }

        const projectId =
          Constants.easConfig?.projectId ??
          Constants.expoConfig?.extra?.eas?.projectId;
        if (!projectId) {
          throw new Error('No EAS project ID; run `eas init` in the app');
        }
        const { data: expoPushToken } =
          await Notifications.getExpoPushTokenAsync({ projectId });
        await registerDevice({
          deviceSecret: env.deviceSecret,
          expoPushToken,
          platform: Platform.OS === 'ios' ? 'ios' : 'android',
          deviceName: Device.deviceName ?? undefined,
          appVersion: Constants.expoConfig?.version,
        });
        setRegistration({ status: 'registered', expoPushToken });
      } catch (error) {
        setRegistration({
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        inFlight.current = null;
      }
    })();
    return inFlight.current;
  }, [ready, channels, registerDevice]);

  useEffect(() => {
    register();
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') register();
    });
    // Fires with the native token; register() fetches the Expo token that wraps it.
    const token = Notifications.addPushTokenListener(() => register());
    return () => {
      appState.remove();
      token.remove();
    };
  }, [register]);

  return (
    <PushRegistrationContext.Provider value={{ registration, register }}>
      {children}
    </PushRegistrationContext.Provider>
  );
}

export function usePushRegistration(): PushRegistrationContextValue {
  const value = useContext(PushRegistrationContext);
  if (!value) {
    throw new Error(
      'usePushRegistration must be used inside PushRegistrationProvider',
    );
  }
  return value;
}
