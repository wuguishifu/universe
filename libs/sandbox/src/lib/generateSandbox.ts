import { existsSync, writeFileSync } from 'fs';
import path from 'path';
import { exit } from 'process';

const filename = require.main?.filename;
if (!filename) {
  throw new Error('Self filename not found');
}

const sandboxFileName = 'sandbox.ts';
const sandboxFullPathName = `${path.dirname(filename)}/../${sandboxFileName}`;

if (existsSync(sandboxFullPathName)) {
  console.log('sandbox.ts file already exists - leaving it alone 👍');
  exit(0);
}

console.log('Creating sandbox.ts file 🏖️ ...');

const starterCode = `(async () => {
  // TODO:
})()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
`;

writeFileSync(sandboxFullPathName, starterCode);

console.log('Done 🏁');
