import { Password } from '@convex-dev/auth/providers/Password';
import { convexAuth } from '@convex-dev/auth/server';
import { ConvexError } from 'convex/values';

/**
 * Email + password only, and sign-ups are closed: the "signUp" flow only works for an email in
 * AUTH_SIGNUP_ALLOWLIST (comma-separated, set on the deployment). Everyone else can only sign in to
 * an account that already exists.
 *
 * This is deployment-wide, so every app on this deployment that uses Convex Auth shares these users.
 */
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile(params) {
        const email = normalizeEmail(params.email);
        if (params.flow === 'signUp' && !signUpAllowlist().includes(email)) {
          throw new ConvexError({ code: 'SIGN_UPS_CLOSED' });
        }
        return { email };
      },
    }),
  ],
});

function normalizeEmail(value: unknown): string {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!email) {
    throw new ConvexError({ code: 'EMAIL_REQUIRED' });
  }
  return email;
}

function signUpAllowlist(): string[] {
  return (process.env.AUTH_SIGNUP_ALLOWLIST ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}
