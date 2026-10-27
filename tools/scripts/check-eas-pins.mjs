// Checks that every eas.json in the repo pins its build image and pnpm to what the root package.json
// uses, since EAS builds don't follow the root on their own:
// - an `sdk-N` image has to match the major version of the root `expo`
// - `pnpm` has to match the root `packageManager`, or EAS can't read the lockfile
//
// Usage: node tools/scripts/check-eas-pins.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const root = JSON.parse(readFileSync('package.json', 'utf8'));
const expoMajor = root.dependencies?.expo?.match(/\d+/)?.[0];
const pnpmVersion = root.packageManager?.match(/^pnpm@([^+]+)/)?.[1];
if (!expoMajor || !pnpmVersion) {
  console.error(
    'check-eas-pins: no expo dependency or pnpm packageManager in package.json',
  );
  process.exit(1);
}

// Tracked and untracked-but-not-ignored, so a new app is checked before its first commit.
const easJsonPaths = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '*eas.json'],
  { encoding: 'utf8' },
)
  .split('\n')
  .filter((path) => path.endsWith('/eas.json') || path === 'eas.json');

const errors = [];
for (const path of easJsonPaths) {
  const profiles = JSON.parse(readFileSync(path, 'utf8')).build ?? {};
  for (const [name, profile] of Object.entries(profiles)) {
    for (const platform of ['ios', 'android']) {
      const image = profile[platform]?.image;
      const sdk = image?.match(/^sdk-(\d+)$/)?.[1];
      if (sdk && sdk !== expoMajor) {
        errors.push(
          `${path}: build.${name}.${platform}.image is "${image}", but the root expo is ${expoMajor} (use "sdk-${expoMajor}")`,
        );
      }
    }
    if (profile.pnpm && profile.pnpm !== pnpmVersion) {
      errors.push(
        `${path}: build.${name}.pnpm is "${profile.pnpm}", but the root packageManager is pnpm@${pnpmVersion}`,
      );
    }
  }
}

if (errors.length > 0) {
  console.error(`check-eas-pins: ${errors.length} mismatched pin(s)`);
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}

console.log(`check-eas-pins: ${easJsonPaths.length} eas.json file(s) OK`);
