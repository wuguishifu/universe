const { defineConfig } = require('eslint/config');

const mainConfig = require('../../eslint.config.js');

module.exports = defineConfig([
  ...mainConfig,
  {
    files: ['**/*'],
    rules: {
      'no-console': 'off',
    },
  },
]);
