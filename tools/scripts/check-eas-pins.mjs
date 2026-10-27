// Checks that every eas.json build profile and EAS workflow (.eas/workflows/*.yml `defaults`) in the
// repo pins its image and pnpm to what the root package.json uses, since EAS doesn't follow the root
// on its own:
// - an `sdk-N` image has to match the major version of the root `expo`
// - `pnpm` has to match the root `packageManager`, or EAS can't read the lockfile
//
// Usage: node tools/scripts/check-eas-pins.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

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
const listFiles = (pattern) =>
  execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', pattern],
    { encoding: 'utf8' },
  )
    .split('\n')
    .filter(Boolean);

const easJsonPaths = listFiles('*eas.json').filter(
  (path) => path.endsWith('/eas.json') || path === 'eas.json',
);
const workflowPaths = listFiles('*.eas/workflows/*.y*ml');

const errors = [];
const checkImage = (where, image) => {
  const sdk = image?.match(/^sdk-(\d+)$/)?.[1];
  if (sdk && sdk !== expoMajor) {
    errors.push(
      `${where} is "${image}", but the root expo is ${expoMajor} (use "sdk-${expoMajor}")`,
    );
  }
};
const checkPnpm = (where, pnpm) => {
  if (pnpm && String(pnpm) !== pnpmVersion) {
    errors.push(
      `${where} is "${pnpm}", but the root packageManager is pnpm@${pnpmVersion}`,
    );
  }
};

for (const path of easJsonPaths) {
  const profiles = JSON.parse(readFileSync(path, 'utf8')).build ?? {};
  for (const [name, profile] of Object.entries(profiles)) {
    for (const platform of ['ios', 'android']) {
      checkImage(
        `${path}: build.${name}.${platform}.image`,
        profile[platform]?.image,
      );
    }
    checkPnpm(`${path}: build.${name}.pnpm`, profile.pnpm);
  }
}

for (const path of workflowPaths) {
  const defaults = parse(readFileSync(path, 'utf8'))?.defaults ?? {};
  checkImage(`${path}: defaults.image`, defaults.image);
  checkPnpm(`${path}: defaults.tools.pnpm`, defaults.tools?.pnpm);
}

if (errors.length > 0) {
  console.error(`check-eas-pins: ${errors.length} mismatched pin(s)`);
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}

console.log(
  `check-eas-pins: ${easJsonPaths.length} eas.json and ${workflowPaths.length} workflow file(s) OK`,
);
