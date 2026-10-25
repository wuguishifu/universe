/**
 * The channels a notification can be sent on. Devices get every channel unless they mute it, so a
 * new channel reaches every device as soon as convex is deployed with it.
 *
 * Its own entry point (`@platform/notifications-contracts/channels`) with no imports, so convex and
 * the mobile app can use it without pulling in BullMQ.
 */
export const NOTIFICATION_CHANNEL_IDS = ['general'] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNEL_IDS)[number];

export type NotificationChannelDefinition = {
  label: string;
  description: string;
};

export const NOTIFICATION_CHANNELS: Record<
  NotificationChannel,
  NotificationChannelDefinition
> = {
  general: {
    label: 'General',
    description: "Anything that doesn't have its own channel.",
  },
};
