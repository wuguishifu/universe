// Replaces `import text from 'some/file?raw'` with the file's contents as a string, like Vite's
// `?raw`. The terminal WebView uses it to inline xterm.js, so the page works offline and nothing
// is fetched from a CDN at runtime. Metro never sees the import: resolution happens here.
const fs = require('node:fs');
const path = require('node:path');

module.exports = function inlineRaw({ types: t }) {
  return {
    name: 'inline-raw',
    visitor: {
      ImportDeclaration(importPath, state) {
        const source = importPath.node.source.value;
        if (!source.endsWith('?raw')) {
          return;
        }
        const [specifier] = importPath.node.specifiers;
        if (
          importPath.node.specifiers.length !== 1 ||
          !t.isImportDefaultSpecifier(specifier)
        ) {
          throw importPath.buildCodeFrameError(
            '?raw imports take exactly one default import',
          );
        }
        const file = require.resolve(source.slice(0, -'?raw'.length), {
          paths: [path.dirname(state.filename)],
        });
        importPath.replaceWith(
          t.variableDeclaration('const', [
            t.variableDeclarator(
              t.identifier(specifier.local.name),
              t.stringLiteral(fs.readFileSync(file, 'utf8')),
            ),
          ]),
        );
      },
    },
  };
};
