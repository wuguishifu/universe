import { ConvexError, v } from 'convex/values';

import { mutation, query } from '../_generated/server';

import {
  assertNotificationsDeviceSecret,
  assertNotificationsSecret,
  notificationsDeviceSecret,
  notificationsSecret,
} from './auth';
import { devicePlatform, notificationChannel } from './validators';

// MARK: notifications-mobile

/** Called on every launch, so it keeps the device's muted channels. */
export const register = mutation({
  args: {
    deviceSecret: notificationsDeviceSecret,
    expoPushToken: v.string(),
    platform: devicePlatform,
    deviceName: v.optional(v.string()),
    appVersion: v.optional(v.string()),
  },
  handler: async (ctx, { deviceSecret, expoPushToken, ...device }) => {
    assertNotificationsDeviceSecret(deviceSecret);
    const existing = await ctx.db
      .query('notificationDevices')
      .withIndex('by_expoPushToken', (q) =>
        q.eq('expoPushToken', expoPushToken),
      )
      .unique();
    if (existing) {
      await ctx.db.patch('notificationDevices', existing._id, {
        ...device,
        lastRegisteredAt: Date.now(),
      });
      return existing._id;
    }
    return ctx.db.insert('notificationDevices', {
      ...device,
      expoPushToken,
      mutedChannels: [],
      lastRegisteredAt: Date.now(),
    });
  },
});

export const get = query({
  args: { deviceSecret: notificationsDeviceSecret, expoPushToken: v.string() },
  handler: (ctx, { deviceSecret, expoPushToken }) => {
    assertNotificationsDeviceSecret(deviceSecret);
    return ctx.db
      .query('notificationDevices')
      .withIndex('by_expoPushToken', (q) =>
        q.eq('expoPushToken', expoPushToken),
      )
      .unique();
  },
});

export const setMutedChannels = mutation({
  args: {
    deviceSecret: notificationsDeviceSecret,
    expoPushToken: v.string(),
    mutedChannels: v.array(notificationChannel),
  },
  handler: async (ctx, { deviceSecret, expoPushToken, mutedChannels }) => {
    assertNotificationsDeviceSecret(deviceSecret);
    const device = await ctx.db
      .query('notificationDevices')
      .withIndex('by_expoPushToken', (q) =>
        q.eq('expoPushToken', expoPushToken),
      )
      .unique();
    if (!device) {
      throw new ConvexError({ code: 'DEVICE_NOT_REGISTERED' });
    }
    await ctx.db.patch('notificationDevices', device._id, {
      mutedChannels: [...new Set(mutedChannels)],
    });
  },
});

// MARK: notifications-service

/** The tokens of every device that hasn't muted `channel`. */
export const listTokensForChannel = query({
  args: { secret: notificationsSecret, channel: notificationChannel },
  handler: async (ctx, { secret, channel }) => {
    assertNotificationsSecret(secret);
    // A handful of devices at most, so there's no index to filter by.
    const devices = await ctx.db.query('notificationDevices').collect();
    return devices
      .filter((device) => !device.mutedChannels.includes(channel))
      .map((device) => device.expoPushToken);
  },
});

/** Removes devices Expo says are gone (DeviceNotRegistered), usually because the app was uninstalled. */
export const removeByTokens = mutation({
  args: { secret: notificationsSecret, expoPushTokens: v.array(v.string()) },
  handler: async (ctx, { secret, expoPushTokens }) => {
    assertNotificationsSecret(secret);
    let removed = 0;
    for (const expoPushToken of new Set(expoPushTokens)) {
      const device = await ctx.db
        .query('notificationDevices')
        .withIndex('by_expoPushToken', (q) =>
          q.eq('expoPushToken', expoPushToken),
        )
        .unique();
      if (device) {
        await ctx.db.delete('notificationDevices', device._id);
        removed++;
      }
    }
    return removed;
  },
});
