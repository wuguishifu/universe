import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { devicePlatform, notificationChannel } from './validators';

export const notificationsTables = {
  /** A device sapphire-mobile is installed on, by its Expo push token. */
  notificationDevices: defineTable({
    expoPushToken: v.string(),
    platform: devicePlatform,
    deviceName: v.optional(v.string()),
    appVersion: v.optional(v.string()),
    /** Channels the device doesn't get. New channels aren't muted, so they reach every device. */
    mutedChannels: v.array(notificationChannel),
    lastRegisteredAt: v.number(),
  }).index('by_expoPushToken', ['expoPushToken']),
} as const;
