const { defineConfig } = require('eslint/config');

const baseConfig = require('../../eslint.config.js');

module.exports = defineConfig([...baseConfig, { files: ['**/*'], rules: { 'no-console': 'off' } }]);
