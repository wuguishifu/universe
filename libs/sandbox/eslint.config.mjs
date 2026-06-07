import baseConfig from '../../eslint.config.mjs';
export default [
  ...baseConfig,
  { ignores: ['**/out-tsc'] },
  {
    files: ['**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
];
