// Writes a `.env.local` next to every app's `environment-config.json`, filled with that app's
// Infisical secrets and, outside production, the local Convex deployment URLs.
//
// Usage: nx setup environment (see tools/environment/README.md)
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const CONFIG_FILENAME = 'environment-config.json';
const ALLOWED_KEYS = ['$schema', 'secretsPaths', 'hasConvex', 'publicPrefix'];
const INFISICAL_ENVIRONMENT_MAP = { development: 'dev', production: 'prod' };

const fail = (message) => {
  console.error(`ERROR: ${message}`);
  process.exit(1);
};

if (process.env.CI === 'true') process.exit(0);

// every path below is relative to the repo root
process.chdir(join(dirname(fileURLToPath(import.meta.url)), '../..'));

// the root `.env` wins over the shell environment
const rootEnv = existsSync('.env') ? dotenv.parse(readFileSync('.env')) : {};
const ENVIRONMENT = rootEnv.ENVIRONMENT || process.env.ENVIRONMENT;
if (!ENVIRONMENT)
  fail('ENVIRONMENT env variable must be set in root `.env` file');

const INFISICAL_ENVIRONMENT = INFISICAL_ENVIRONMENT_MAP[ENVIRONMENT];
if (!INFISICAL_ENVIRONMENT) {
  fail(
    `unknown ENVIRONMENT "${ENVIRONMENT}", expected one of: ${Object.keys(INFISICAL_ENVIRONMENT_MAP).join(', ')}`,
  );
}

const { infisicalDomain, infisicalProjectId } = JSON.parse(
  readFileSync('tools/environment/config.json', 'utf8'),
);

// MARK: discover app configs

// every app that needs environment variables has an `environment-config.json` at its root
// includes untracked (but not ignored) files so new apps work before their first commit
const configFiles = execFileSync(
  'git',
  [
    'ls-files',
    '-z',
    '--cached',
    '--others',
    '--exclude-standard',
    '--',
    `*${CONFIG_FILENAME}`,
    CONFIG_FILENAME,
  ],
  { encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean);

// validate every config before writing anything
const apps = [];
for (const configFile of new Set(configFiles)) {
  // tracked files deleted from the working tree are still listed by --cached
  if (!existsSync(configFile)) continue;

  let config;
  try {
    config = JSON.parse(readFileSync(configFile, 'utf8'));
  } catch {
    config = undefined;
  }
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    fail(`${configFile} is not a valid JSON object`);
  }

  const unknownKeys = Object.keys(config).filter(
    (key) => !ALLOWED_KEYS.includes(key),
  );
  if (unknownKeys.length > 0) {
    fail(
      `${configFile} has unknown keys: ${unknownKeys.join(', ')}\n` +
        '       allowed keys are defined in tools/environment/environment-config.schema.json',
    );
  }

  apps.push({ dir: dirname(configFile), config });
}

if (apps.length === 0) fail(`No ${CONFIG_FILENAME} files found`);

// MARK: copy secrets

const stripLeadingSlash = (path) => path.replace(/^\//, '');

// collect the unique infisical paths across all apps so each one is fetched once
const allSecretsPaths = [
  ...new Set(
    apps.flatMap(({ config }) =>
      (config.secretsPaths ?? []).map(stripLeadingSlash),
    ),
  ),
];

// verify the CLI session once before fetching in parallel
// without a valid session, every parallel `infisical secrets` call starts its own browser login flow
// this check triggers at most one login flow if the session is missing or expired
const tokenCheck = spawnSync(
  'infisical',
  ['user', 'get', 'token', '--plain', '--silent', '--domain', infisicalDomain],
  { stdio: ['inherit', 'ignore', 'inherit'] },
);
if (tokenCheck.error?.code === 'ENOENT') {
  fail('infisical CLI not found, see tools/environment/README.md');
}
if (tokenCheck.status !== 0) {
  fail(
    'infisical CLI is not authenticated, run `nx auth environment` and try again',
  );
}

const fetchSecrets = (path) =>
  new Promise((resolve) => {
    console.log(`Loading secrets from infisical path: /${path}`);
    const child = spawn(
      'infisical',
      [
        'secrets',
        '--silent',
        '--domain',
        infisicalDomain,
        '--env',
        INFISICAL_ENVIRONMENT,
        '--projectId',
        infisicalProjectId,
        '--path',
        `/${path}`,
        '--output',
        'dotenv',
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    let stdout = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
    child.on('error', () => resolve({ path, ok: false }));
    child.on('close', (code) => resolve({ path, ok: code === 0, stdout }));
  });

const results = await Promise.all(allSecretsPaths.map(fetchSecrets));
const failed = results.filter(({ ok }) => !ok);
for (const { path } of failed) {
  console.error(`ERROR: failed to load secrets from infisical path: /${path}`);
}
if (failed.length > 0) process.exit(1);

// infisical's dotenv output can contain CRLF on Windows
const secretsByPath = new Map(
  results.map(({ path, stdout }) => [
    path,
    stdout.replace(/\r\n/g, '\n').replace(/\n+$/, ''),
  ]),
);

// dedupe keys so the last definition wins, keeping first-seen order
// lines that don't start a new `KEY=` belong to the previous key (multi-line values)
const dedupeDotenv = (lines) => {
  const values = new Map();
  let key = '';
  for (const line of lines) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (match) {
      key = match[1];
      values.set(key, line);
    } else if (key !== '') {
      values.set(key, `${values.get(key)}\n${line}`);
    }
  }
  return [...values.values()];
};

// apps are paths relative to the repo root (e.g. `platform/transcription/service`)
for (const { dir, config } of apps) {
  const lines = [
    '# ! IMPORTANT: This .env file is auto-generated by tools/environment.',
    '# ! Do not edit this file directly.',
    `ENVIRONMENT=${ENVIRONMENT}`,
  ];

  // the presence of `secretsPaths` means the app has secrets
  // paths are layered in order, later paths override earlier ones
  if (config.secretsPaths) {
    const secretLines = config.secretsPaths.flatMap((path) =>
      secretsByPath.get(stripLeadingSlash(path)).split('\n'),
    );
    lines.push(...dedupeDotenv(secretLines));
  }

  writeFileSync(join(dir, '.env.local'), `${lines.join('\n')}\n`);
}

// MARK: copy convex variables

if (ENVIRONMENT === 'production') {
  console.log(
    'Skipping convex environment variables for production environment',
  );
  process.exit(0);
}

const CONVEX_ENV_FILE = 'platform/convex/app/.env.local';
if (!existsSync(CONVEX_ENV_FILE)) fail('convex .env.local missing');

const { CONVEX_URL, CONVEX_SITE_URL } = dotenv.parse(
  readFileSync(CONVEX_ENV_FILE),
);
if (!CONVEX_URL || !CONVEX_SITE_URL)
  fail('CONVEX_URL or CONVEX_SITE_URL missing');

for (const { dir, config } of apps) {
  if (!config.hasConvex) continue;

  console.log(`Loading convex env variables for: ${dir}`);
  const prefix = config.publicPrefix ?? '';
  const envFile = join(dir, '.env.local');
  writeFileSync(
    envFile,
    readFileSync(envFile, 'utf8') +
      [
        '',
        '# convex variables',
        `${prefix}CONVEX_URL=${CONVEX_URL}`,
        `${prefix}CONVEX_SITE_URL=${CONVEX_SITE_URL}`,
      ].join('\n') +
      '\n',
  );
}
