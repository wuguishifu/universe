import { v } from 'convex/values';

import { NOTIFICATION_CHANNEL_IDS } from '@platform/notifications-contracts/channels';

export const notificationChannel = v.union(
  ...NOTIFICATION_CHANNEL_IDS.map((id) => v.literal(id)),
);

export const devicePlatform = v.union(v.literal('ios'), v.literal('android'));
