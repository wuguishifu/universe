const { mergeConfig } = require('@expo/metro/metro-config');
const { withNxMetro } = require('@nx/expo');
// Expo SDK 55+ ships Metro via `@expo/metro`. `getDefaultConfig` and
// `mergeConfig` must come from the Expo-provided Metro instance.
const { getDefaultConfig } = require('expo/metro-config');

const defaultConfig = getDefaultConfig(__dirname);

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('metro-config').MetroConfig}
 */
const customConfig = {
  // babel/inline-raw.js inlines xterm into the terminal page, and Metro's transform cache doesn't
  // know about that file, so an xterm upgrade has to bust the cache itself.
  cacheVersion: [
    'sapphire-mobile',
    ...['@xterm/xterm', '@xterm/addon-fit'].map(
      (name) => `${name}@${require(`${name}/package.json`).version}`,
    ),
  ].join(':'),
};

module.exports = withNxMetro(mergeConfig(defaultConfig, customConfig), {
  // Change this to true to see debugging info.
  // Useful if you have issues resolving modules
  debug: false,
  // all the file extensions used for imports other than 'ts', 'tsx', 'js', 'jsx', 'json'
  extensions: [],
  // Specify folders to watch, in addition to Nx defaults (workspace libraries and node_modules)
  watchFolders: [],
});
