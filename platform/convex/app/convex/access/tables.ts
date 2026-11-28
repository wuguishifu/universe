import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { appValidator } from './apps';

export const accessTables = {
  /**
   * Who may use which app. Keyed by email rather than user so someone can be invited before they
   * have an account: signing up needs at least one grant, and each app's functions check for their
   * own (./helpers.ts). Managed in admin-web.
   */
  accessGrants: defineTable({
    /** Normalized (trimmed, lowercase), the same as `users.email`. */
    email: v.string(),
    app: appValidator,
    grantedAt: v.number(),
    /** Unset for grants made from the CLI (internal.access.internal.grant). */
    grantedBy: v.optional(v.id('users')),
  })
    .index('by_email_app', ['email', 'app'])
    .index('by_app', ['app']),
};
