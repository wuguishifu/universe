// The fingerprint decides whether a merge ships as an OTA update or needs a new native build (see
// .eas/workflows/build.yml), so it has to change exactly when the native layer does.
const { readdirSync } = require('node:fs');
const { join } = require('node:path');

// The Go proxy is compiled into the native module by gomobile (../proxy/build.sh), so autolinking
// only sees its build output. Hash the Go sources instead, since that output differs from machine
// to machine and is missing wherever the build script hasn't run.
const proxyRoot = '../proxy';
const proxySources = readdirSync(join(__dirname, proxyRoot))
  .filter(
    (file) =>
      (file.endsWith('.go') && !file.endsWith('_test.go')) ||
      file === 'go.mod' ||
      file === 'go.sum',
  )
  .map((file) => ({
    type: 'file',
    filePath: `${proxyRoot}/${file}`,
    reasons: ['sapphireProxyGoSources'],
  }));

/** @type {import('@expo/fingerprint').Config} */
module.exports = {
  ignorePaths: [
    `${proxyRoot}/ios/Frameworks/**`,
    `${proxyRoot}/android/libs/**`,
    `${proxyRoot}/android/build/**`,
  ],
  extraSources: proxySources,
};
