import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Alert, Linking } from 'react-native';

/**
 * Opens a tapped notification's `url`: a path starting with `/` is an in-app route, anything else
 * opens in whatever handles it (usually the browser). Covers taps that launched the app too.
 */
export function useNotificationRouting() {
  const router = useRouter();

  useEffect(() => {
    let lastHandled: string | undefined;
    const open = (response: Notifications.NotificationResponse) => {
      // A tap that launches the app can come through both the last response and the listener.
      const { identifier, content } = response.notification.request;
      if (identifier === lastHandled) return;
      lastHandled = identifier;

      const url = content.data?.url;
      if (typeof url !== 'string' || !url) return;
      if (url.startsWith('/')) {
        router.push(url);
      } else {
        Linking.openURL(url).catch(() => {
          Alert.alert("Couldn't open the notification's link", url);
        });
      }
    };

    const launchResponse = Notifications.getLastNotificationResponse();
    if (launchResponse) {
      open(launchResponse);
      // Otherwise it's opened again whenever this remounts.
      Notifications.clearLastNotificationResponse();
    }
    const subscription =
      Notifications.addNotificationResponseReceivedListener(open);
    return () => subscription.remove();
  }, [router]);
}
