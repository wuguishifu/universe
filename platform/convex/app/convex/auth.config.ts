// Convex Auth issues its own JWTs, signed with JWT_PRIVATE_KEY and served at
// `${CONVEX_SITE_URL}/.well-known/jwks.json`. finance-service verifies them against the same JWKS.
export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL,
      applicationID: 'convex',
    },
  ],
};
