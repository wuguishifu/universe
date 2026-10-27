import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export type Channel = { id: string; label: string; description: string };

/**
 * Mirrors the notification channels as Android ones, so each gets its own settings in Android's
 * system settings. notifications-service sends each notification with its channel as `channelId`.
 * Creating a channel that exists only updates its name and description.
 */
export async function syncAndroidChannels(channels: Channel[]): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Promise.all(
    channels.map(({ id, label, description }) =>
      Notifications.setNotificationChannelAsync(id, {
        name: label,
        description,
        importance: Notifications.AndroidImportance.HIGH,
      }),
    ),
  );
}
