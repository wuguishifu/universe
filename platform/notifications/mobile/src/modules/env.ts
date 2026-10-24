// Read with static `process.env.EXPO_PUBLIC_*` accesses, which is what Expo inlines into the bundle.
const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
if (!convexUrl) {
  throw new Error('Missing EXPO_PUBLIC_CONVEX_URL environment variable');
}

const deviceSecret = process.env.EXPO_PUBLIC_NOTIFICATIONS_DEVICE_SECRET;
if (!deviceSecret) {
  throw new Error(
    'Missing EXPO_PUBLIC_NOTIFICATIONS_DEVICE_SECRET environment variable',
  );
}

export const env = { convexUrl, deviceSecret };
