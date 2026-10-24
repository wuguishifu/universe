const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');

const { join } = require('path');

module.exports = {
  output: {
    path: join(__dirname, '../../../dist/projects/thermo-automation/service'),
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      tsConfig: './tsconfig.app.json',
      assets: [],
      outputHashing: 'none',
      generatePackageJson: true,
    }),
  ],
};
