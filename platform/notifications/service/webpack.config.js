const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');

const { join } = require('path');

const {
  BundleBuildableLibsPlugin,
} = require('../../../tools/webpack/bundle-buildable-libs-plugin');

module.exports = {
  output: {
    path: join(__dirname, '../../../dist/platform/notifications/service'),
    clean: true,
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      tsConfig: './tsconfig.app.json',
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: true,
      sourceMap: true,
    }),
    new BundleBuildableLibsPlugin(['@platform/convex-contracts']),
  ],
};
