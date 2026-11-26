import baseConfig from '../../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    // these are console scripts: logging is the output
    rules: { 'no-console': 'off' },
  },
];
