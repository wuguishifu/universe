import 'server-only';

import { NotificationsClient } from '@platform/notifications-client-next';

import { requireEnv } from '../server-env';

export const notifications = new NotificationsClient(() => {
  const cfClientId = process.env.CF_ACCESS_CLIENT_ID;
  const cfClientSecret = process.env.CF_ACCESS_CLIENT_SECRET;
  return {
    serviceName: 'sapphire-web',
    baseUrl: requireEnv('NOTIFICATIONS_SERVICE_URL'),
    apiToken: requireEnv('NOTIFICATIONS_SERVICE_API_TOKEN'),
    // Vercel reaches the tailnet through a Cloudflare tunnel behind Access.
    headers:
      cfClientId && cfClientSecret
        ? {
            'CF-Access-Client-Id': cfClientId,
            'CF-Access-Client-Secret': cfClientSecret,
          }
        : undefined,
  };
});
