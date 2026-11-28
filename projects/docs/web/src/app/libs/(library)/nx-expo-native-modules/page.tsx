import type { ReactNode } from 'react';

import { Code, CodeBlock } from '../../../../components/code';
import { ExternalLink } from '../../../../components/external-link';
import { Table } from '../../../../components/table';

const installSnippet = `pnpm add -D @wuguishifu/nx-expo-native-modules`;

const usageSnippet = `nx g @wuguishifu/nx-expo-native-modules:native-module libs/my-module`;

const explicitUsageSnippet = `nx g @wuguishifu/nx-expo-native-modules:native-module libs/my-module \\
  --name=hello-world \\
  --importPath=@myorg/hello-world \\
  --androidNamespace=dev.expo.helloworld \\
  --author="Your Name" \\
  --description="Says hello from native code"`;

const generatedTree = `libs/my-module/
├── .babelrc.js                       # @nx/react/babel preset, babel-preset-expo for tests
├── eslint.config.mjs                 # extends the workspace root config
├── expo-module.config.json           # registers the Apple + Android modules with Expo
├── package.json                      # expo/react/react-native peer deps
├── project.json
├── tsconfig.json
├── android/
│   ├── build.gradle                  # com.android.library + expo-module-gradle-plugin
│   └── src/main/
│       ├── AndroidManifest.xml
│       └── java/dev/expo/helloworld/
│           ├── HelloWorldModule.kt   # Module with a hello() function and a view
│           └── HelloWorldView.kt     # ExpoView subclass
├── ios/
│   ├── HelloWorld.podspec            # depends on ExpoModulesCore
│   ├── HelloWorldModule.swift        # Module with a hello() function and a view
│   └── HelloWorldView.swift          # ExpoView subclass
└── src/
    ├── index.ts
    ├── hello-world-module.ts         # requireNativeModule<HelloWorldModule>(...)
    └── hello-world-view.tsx          # requireNativeView(...)`;

const optionRows: {
  option: string;
  type: string;
  defaultValue: ReactNode;
  description: ReactNode;
}[] = [
  {
    option: 'directory',
    type: 'string',
    defaultValue: '— (required, positional)',
    description: 'Directory the module is created in.',
  },
  {
    option: 'name',
    type: 'string',
    defaultValue: (
      <>
        last segment of <Code>directory</Code>
      </>
    ),
    description: (
      <>
        Module name. <Code>Module</Code> is appended to the generated class
        name.
      </>
    ),
  },
  {
    option: 'bundler',
    type: "'tsc' | 'none'",
    defaultValue: <Code>&apos;tsc&apos;</Code>,
    description: (
      <>
        <Code>&apos;none&apos;</Code> makes the library non-buildable and emits
        declarations only.
      </>
    ),
  },
  {
    option: 'importPath',
    type: 'string',
    defaultValue: <Code>name</Code>,
    description: (
      <>
        Package name used to import the module, e.g.{' '}
        <Code>@myorg/my-module</Code>. Required to publish it.
      </>
    ),
  },
  {
    option: 'androidNamespace',
    type: 'string',
    defaultValue: <Code>&apos;com.example&apos;</Code>,
    description: (
      <>
        Android namespace, e.g. <Code>dev.expo.mymodule</Code>. The module name
        is appended if not already last.
      </>
    ),
  },
  {
    option: 'description',
    type: 'string',
    defaultValue: <Code>&apos;A description&apos;</Code>,
    description: (
      <>
        Used for both <Code>s.summary</Code> and <Code>s.description</Code> in
        the podspec.
      </>
    ),
  },
  {
    option: 'author',
    type: 'string',
    defaultValue: 'empty',
    description: (
      <>
        Used for <Code>s.author</Code> in the podspec.
      </>
    ),
  },
  {
    option: 'homepage',
    type: 'string',
    defaultValue: "this repository's URL",
    description: (
      <>
        Used for <Code>s.homepage</Code> in the podspec.
      </>
    ),
  },
];

export default function NxExpoNativeModules() {
  return (
    <main className="flex-1 px-6 py-8 md:px-10">
      <article className="mx-auto max-w-3xl">
        <h1>@wuguishifu/nx-expo-native-modules</h1>

        <ExternalLink href="https://github.com/wuguishifu/generators">
          View on GitHub
        </ExternalLink>

        <p>
          An <ExternalLink href="https://nx.dev">Nx</ExternalLink> plugin that
          scaffolds{' '}
          <ExternalLink href="https://docs.expo.dev/modules/overview/">
            Expo native modules
          </ExternalLink>{' '}
          inside an Nx workspace.
        </p>

        <p>
          Writing an Expo native module by hand means creating a Swift module, a
          Kotlin module, a podspec, a Gradle build file, an{' '}
          <Code>expo-module.config.json</Code>, and the TypeScript layer that
          bridges them — and then wiring all of that into the workspace&apos;s
          Babel, TypeScript, and Nx configuration. This plugin does that in one
          command.
        </p>

        <h2>Installation</h2>

        <CodeBlock>{installSnippet}</CodeBlock>

        <h2>Usage</h2>

        <CodeBlock>{usageSnippet}</CodeBlock>

        <p>
          The first positional argument is the <Code>directory</Code> the module
          is created in. The module name defaults to the last segment of that
          path, so the command above generates a <Code>MyModule</Code> native
          module. To set things explicitly:
        </p>

        <CodeBlock>{explicitUsageSnippet}</CodeBlock>

        <p>
          Add <Code>--dry-run</Code> to preview the changes without writing
          them.
        </p>

        <h2>What gets generated</h2>

        <CodeBlock>{generatedTree}</CodeBlock>

        <p>
          Both platforms are generated with a matching <Code>hello()</Code>{' '}
          function and a native view that renders a centered label, so the
          module works as-is and gives you a running starting point on each
          platform.
        </p>

        <h2>What it changes in the workspace</h2>

        <p>Beyond the new project directory, the generator also:</p>

        <ul className="my-4 list-disc space-y-2 pl-6">
          <li>
            <strong>
              Adds a root <Code>babel.config.json</Code>
            </strong>{' '}
            with <Code>babelrcRoots: [&apos;*&apos;]</Code>, so per-project{' '}
            <Code>.babelrc.js</Code> files are picked up in a monorepo. Skipped
            if the workspace already has a <Code>babel.config.json</Code> or{' '}
            <Code>babel.config.js</Code>.
          </li>
          <li>
            <strong>Registers the project</strong> in the root{' '}
            <Code>tsconfig.json</Code> <Code>references</Code> array.
          </li>
          <li>
            <strong>
              Adds dependencies to the root <Code>package.json</Code>.
            </strong>{' '}
            With the default <Code>--bundler=tsc</Code>: <Code>expo</Code>,{' '}
            <Code>react</Code>, <Code>react-dom</Code>, and{' '}
            <Code>react-native</Code> as dependencies, plus{' '}
            <Code>@nx/expo</Code>, <Code>@nx/react</Code>,{' '}
            <Code>@expo/cli</Code>, <Code>@types/node</Code>,{' '}
            <Code>metro-config</Code>, <Code>metro-resolver</Code>, and{' '}
            <Code>tslib</Code> as dev dependencies. With{' '}
            <Code>--bundler=none</Code>, only <Code>@types/node</Code>. Existing
            versions are kept, so this never overwrites versions the workspace
            has already pinned.
          </li>
          <li>
            <strong>
              Reads <Code>customConditions</Code> from{' '}
              <Code>tsconfig.base.json</Code>
            </strong>{' '}
            and uses the first entry as the source condition in the generated{' '}
            <Code>package.json</Code> export map, matching how the rest of the
            workspace resolves TypeScript sources.
          </li>
        </ul>

        <p>
          The generator expects a root <Code>tsconfig.base.json</Code> and{' '}
          <Code>tsconfig.json</Code> to exist, and throws if either is missing.
        </p>

        <h2>Options</h2>

        <Table
          head={['Option', 'Type', 'Default', 'Description']}
          nowrapColumns={[0, 1]}
          rows={optionRows.map((row) => [
            <Code key="option">{row.option}</Code>,
            <Code key="type">{row.type}</Code>,
            row.defaultValue,
            row.description,
          ])}
        />

        <h3>Naming</h3>

        <p>
          <Code>name</Code> is lowercased and split on spaces, hyphens, and
          underscores, then recombined. It is <strong>not</strong> split on
          camelCase boundaries, so pass <Code>hello-world</Code>,{' '}
          <Code>hello_world</Code>, or <Code>&quot;hello world&quot;</Code> to
          get <Code>HelloWorldModule</Code> — passing <Code>HelloWorld</Code>{' '}
          yields <Code>HelloworldModule</Code>.
        </p>
      </article>
    </main>
  );
}
