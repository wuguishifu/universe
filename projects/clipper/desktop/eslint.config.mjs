import baseConfig from '../../../eslint.config.mjs';

export default [
  ...baseConfig,
  { ignores: ['vite.config.ts', 'src-tauri/**', 'crates/**', 'target/**'] },
];
