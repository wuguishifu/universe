import baseConfig from '../../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    ignores: ['babel.config.js', 'metro.config.js', 'ios', 'android', '.expo'],
  },
];
