import { ConvexError, v } from 'convex/values';

/**
 * Notifications' functions are public and a deployment URL isn't a secret, so each one takes one of
 * these arguments. Call the matching assert first thing in every handler.
 *
 * - `deviceSecret` (NOTIFICATIONS_DEVICE_SECRET) is baked into sapphire-mobile, so it only
 *   lets a device register and change its own preferences.
 * - `secret` (NOTIFICATIONS_CONVEX_SECRET) stays on notifications-service, which reads and prunes
 *   devices.
 */
export const notificationsDeviceSecret = v.string();
export const notificationsSecret = v.string();

export function assertNotificationsDeviceSecret(secret: string): void {
  assertSecret('NOTIFICATIONS_DEVICE_SECRET', secret);
}

export function assertNotificationsSecret(secret: string): void {
  assertSecret('NOTIFICATIONS_CONVEX_SECRET', secret);
}

function assertSecret(envVar: string, secret: string): void {
  const expected = process.env[envVar];
  if (!expected) {
    throw new ConvexError(`${envVar} is not set on this deployment`);
  }
  if (secret !== expected) {
    throw new ConvexError('Unauthorized');
  }
}
