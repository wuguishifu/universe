// Expo's defaults already handle the monorepo (watching the workspace root, resolving hoisted packages).
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// The workspace root has the web apps' React, which isn't the one React Native needs. Resolve every
// import of react, including those from hoisted packages like react-query, to this app's copy, as if
// imported from here, so there's one React and it's the right one.
const fromApp = path.join(__dirname, 'package.json');
config.resolver.resolveRequest = (context, moduleName, platform) =>
  context.resolveRequest(
    moduleName === 'react' || moduleName.startsWith('react/')
      ? { ...context, originModulePath: fromApp }
      : context,
    moduleName,
    platform,
  );

module.exports = config;
