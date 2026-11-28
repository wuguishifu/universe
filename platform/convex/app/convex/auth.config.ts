// Convex Auth issues its own JWTs, signed with JWT_PRIVATE_KEY and served at
// `${CONVEX_SITE_URL}/.well-known/jwks.json` (set both with tools/scripts/convex-auth-keys.mjs).
// Services outside convex can verify the same tokens against that JWKS.
export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL,
      applicationID: 'convex',
    },
  ],
};
