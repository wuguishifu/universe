import {
  NOTIFICATION_CHANNEL_IDS,
  NOTIFICATION_CHANNELS,
} from '@platform/notifications-contracts/channels';

import { query } from '../_generated/server';

import {
  assertNotificationsDeviceSecret,
  notificationsDeviceSecret,
} from './auth';

/** Read by sapphire-mobile, so a new channel shows up there once convex is deployed. */
export const list = query({
  args: { deviceSecret: notificationsDeviceSecret },
  handler: (_ctx, { deviceSecret }) => {
    assertNotificationsDeviceSecret(deviceSecret);
    return NOTIFICATION_CHANNEL_IDS.map((id) => ({
      id,
      ...NOTIFICATION_CHANNELS[id],
    }));
  },
});
