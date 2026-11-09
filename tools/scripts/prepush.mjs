// Runs lint, typecheck and circular-deps before a push: every project on main, affected projects elsewhere.
//
// Usage: node tools/scripts/prepush.mjs (run by the husky pre-push hook via `pnpm prepush`)
import { execFileSync, spawnSync } from 'node:child_process';

// `shell` lets Windows resolve `nx` to its `nx.cmd` shim in node_modules/.bin
const run = (command) => {
  const { status } = spawnSync(command, { stdio: 'inherit', shell: true });
  if (status !== 0) process.exit(status ?? 1);
};

run('node tools/scripts/check-eas-pins.mjs');

const currentBranch = execFileSync('git', ['branch', '--show-current'], {
  encoding: 'utf8',
}).trim();

const targets = '-t lint,typecheck,circular-deps --output-style=stream';
if (currentBranch === 'main') {
  console.log('running `nx run-many`');
  run(`nx run-many ${targets}`);
} else {
  console.log('running `nx affected`');
  run(`nx affected ${targets} --base=main --head=HEAD`);
}
