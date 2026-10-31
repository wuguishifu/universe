/**
 * Workspace libs with their own build target (e.g. `@platform/convex-contracts`)
 * are left external by NxAppWebpackPlugin, but prune-deploy-manifest.mjs strips
 * `workspace:*` deps from the deploy manifest, so they must be bundled into
 * main.js instead.
 *
 * Must be listed after NxAppWebpackPlugin, which sets `compiler.options.externals`.
 *
 * Usage: `new BundleBuildableLibsPlugin(['@platform/convex-contracts'])`
 *
 * @example
 * ```js
 * // webpack.config.js
 * module.exports = {
 *   ...,
 *   plugins: [
 *     ...,
 *     new BundleBuildableLibsPlugin(['@platform/convex-contracts']),
 *   ],
 * }
 * ```
 */
class BundleBuildableLibsPlugin {
  constructor(libs) {
    this.libs = libs;
  }

  isBundled(request) {
    return this.libs.some(
      (lib) => request === lib || request?.startsWith(`${lib}/`),
    );
  }

  apply(compiler) {
    const externals = [compiler.options.externals ?? []].flat();
    compiler.options.externals = externals.map((external) =>
      typeof external === 'function'
        ? (data, callback) =>
            this.isBundled(data.request) ? callback() : external(data, callback)
        : external,
    );
  }
}

module.exports = { BundleBuildableLibsPlugin };
