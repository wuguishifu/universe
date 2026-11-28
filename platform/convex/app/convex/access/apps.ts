import { type Infer, v } from 'convex/values';

/**
 * Every app that signs people in with Convex Auth. Accounts are deployment-wide (one `users` table
 * for every app), so what someone can use is decided per app by their grants (./tables.ts).
 *
 * To add an app: add it here and to APP_LABELS, then grant yourself access in admin-web.
 */
export const appValidator = v.union(
  v.literal('admin'),
  v.literal('finance'),
  v.literal('janktm'),
);

export type App = Infer<typeof appValidator>;

export const APP_LABELS: Record<App, string> = {
  admin: 'Admin',
  finance: 'Finance',
  janktm: 'Jank™',
};

export const APPS = Object.keys(APP_LABELS).filter(isApp);

function isApp(value: string): value is App {
  return value in APP_LABELS;
}
