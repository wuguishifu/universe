import { execFileSync } from 'node:child_process';
import { copyFile, cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const packageRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(packageRoot, '../..');
const hydrogenRoot = path.join(workspaceRoot, 'apps/hydrogen');
const hydrogenDist = path.join(hydrogenRoot, 'dist');
const outputRoot = path.join(packageRoot, 'dist');
const outputGeneratedRoot = path.join(outputRoot, 'convex/_generated');

const copyGeneratedFile = async (filename) => {
  const destination = path.join(outputGeneratedRoot, filename);

  await rm(destination, { force: true });
  await copyFile(
    path.join(hydrogenRoot, 'convex/_generated', filename),
    destination,
  );
};

const buildIndexJs = `export { api, internal, components } from './convex/_generated/api.js';
`;

const buildIndexDts = `export { api, internal, components } from './convex/_generated/api.js';
export type * from './convex/_generated/dataModel.js';
`;

const buildDataModelJs = `export {};
`;

execFileSync(
  'bun',
  ['exec', 'tsc', '--build', path.join(hydrogenRoot, 'tsconfig.lib.json')],
  {
    cwd: workspaceRoot,
    stdio: 'inherit',
  },
);

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputGeneratedRoot, { recursive: true });

await cp(path.join(hydrogenDist, 'convex'), path.join(outputRoot, 'convex'), {
  recursive: true,
});

await copyGeneratedFile('api.d.ts');
await copyGeneratedFile('api.js');
await copyGeneratedFile('dataModel.d.ts');

await writeFile(path.join(outputRoot, 'index.js'), buildIndexJs);
await writeFile(path.join(outputRoot, 'index.d.ts'), buildIndexDts);
await writeFile(
  path.join(outputGeneratedRoot, 'dataModel.js'),
  buildDataModelJs,
);
