import { query } from '../_generated/server';

import { appValidator } from './apps';
import { findGrant, getViewer } from './helpers';

export type AccessStatus = 'signedOut' | 'noAccess' | 'ok';

/**
 * Whether the caller can use `app`. @libs/web-auth's proxy calls this on every page request to
 * pick between the app, its sign-in page and its "no access" page. It only gates pages: each app's
 * functions still check for themselves (./functions.ts).
 */
export const status = query({
  args: { app: appValidator },
  handler: async (
    ctx,
    { app },
  ): Promise<{ status: AccessStatus; email: string | null }> => {
    const viewer = await getViewer(ctx);
    if (!viewer) return { status: 'signedOut', email: null };
    const grant = await findGrant(ctx, viewer.email, app);
    return { status: grant ? 'ok' : 'noAccess', email: viewer.email };
  },
});
