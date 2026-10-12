const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');
const {
  BundleBuildableLibsPlugin,
} = require('../../../tools/webpack/bundle-buildable-libs-plugin');

module.exports = {
  output: {
    path: join(__dirname, '../../../dist/projects/clipper/service'),
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
    new BundleBuildableLibsPlugin(['@platform/convex-contracts']),
  ],
};
