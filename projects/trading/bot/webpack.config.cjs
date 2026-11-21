const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');

const { join } = require('path');

/**
 * The project's package.json says `"type": "module"` so its tests can run as ESM through
 * @swc-node/register, but webpack emits a CommonJS main.js. Drop `type` from the package.json that
 * generatePackageJson writes next to it, or Node would refuse to run main.js.
 */
class CommonJsManifestPlugin {
  apply(compiler) {
    const { Compilation, sources } = compiler.webpack;
    compiler.hooks.thisCompilation.tap(
      'CommonJsManifestPlugin',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'CommonJsManifestPlugin',
            stage: Compilation.PROCESS_ASSETS_STAGE_REPORT,
          },
          () => {
            const asset = compilation.getAsset('package.json');
            if (!asset) return;
            const manifest = JSON.parse(asset.source.source().toString());
            delete manifest.type;
            compilation.updateAsset(
              'package.json',
              new sources.RawSource(JSON.stringify(manifest, null, 2) + '\n'),
            );
          },
        );
      },
    );
  }
}

module.exports = {
  output: {
    path: join(__dirname, '../../../dist/projects/trading/bot'),
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
    new CommonJsManifestPlugin(),
  ],
};
