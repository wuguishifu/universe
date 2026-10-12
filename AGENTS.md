# Universe Monorepo Instructions and Hints

## Hints

- If a nest.js application is using convex, it will fail when built into the Docker image because of the buildable `@platform/convex-contracts` lib. To fix this, make sure the `webpack.config.js` is updated to include the custom `BundleBuildableLibsPlugin` from @tools/webpack/bundle-buildable-libs-plugin.
