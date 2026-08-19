// Cleans the package.json that Nx's generatePackageJson emits into dist/apps/<app>
// so it can be installed standalone in a Docker runtime stage:
// - workspace:* libs are already bundled into main.js by webpack, and their
//   "workspace:" specifiers don't resolve outside the monorepo
// - @nx/webpack leaks in via webpack.config.js but is never required at runtime
//
// Usage: node tools/scripts/prune-deploy-manifest.mjs dist/apps/<app>/package.json
import { readFileSync, writeFileSync } from 'node:fs';

const manifestPath = process.argv[2];
if (!manifestPath) {
  console.error('usage: node prune-deploy-manifest.mjs <path-to-package.json>');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.dependencies = Object.fromEntries(
  Object.entries(manifest.dependencies ?? {}).filter(
    ([name, spec]) => !spec.startsWith('workspace:') && name !== '@nx/webpack',
  ),
);
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
