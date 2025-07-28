const chalk = require('chalk');
const { exit, stdin, stdout } = require('process');
const readline = require('readline/promises');

const isCI = process.env.CI === 'true';
const ENV = process.env.ENVIRONMENT || 'development';

const withProductionConfirmation = async (params) => {
  const { fn, message, shouldByPassCI } = params;
  if ((isCI && shouldByPassCI) || ENV === 'development') {
    return fn();
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(
    chalk.red(
      `You are currently in ${ENV} in non-CI environment. ${message}. Are you sure you know want you are doing and want to continue? (y/n)`,
    ),
  );
  rl.close();
  if (answer.toLowerCase() !== 'y') {
    exit(0);
  } else {
    fn();
  }
};

module.exports = { withProductionConfirmation };
