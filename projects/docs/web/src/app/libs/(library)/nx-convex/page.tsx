import type { ReactNode } from 'react';

import { Code, CodeBlock } from '../../../../components/code';
import { ExternalLink } from '../../../../components/external-link';
import { Table } from '../../../../components/table';

const installSnippet = `pnpm add -D @wuguishifu/nx-convex`;

const usageSnippet = `nx g @wuguishifu/nx-convex:convex-app apps/my-backend libs/my-backend-kore`;

const explicitUsageSnippet = `nx g @wuguishifu/nx-convex:convex-app apps/my-backend libs/my-backend-kore \\
  --appName=my-backend \\
  --contractLibName=my-backend-kore \\
  --importPath=@myorg/my-backend-kore`;

const generatedTree = `apps/my-backend/
├── .gitignore                  # ignores .env.local
├── convex.json
├── eslint.config.mjs
├── index.ts                    # re-exports only convex/_generated
├── package.json
├── project.json
├── tsconfig.json
├── tsconfig.lib.json
└── convex/
    ├── convex.config.ts
    ├── schema.ts               # example \`notes\` table
    └── _generated/             # only with --deferConvexSetup

libs/my-backend-kore/
├── README.md
├── package.json                # exports ./convex/_generated/{api,dataModel}
├── project.json
├── tsconfig.json
├── tsconfig.lib.json
└── scripts/
    └── build.mjs               # packages generated artifacts into dist/`;

const consumeSnippet = `import { api } from '@myorg/my-backend-kore';`;

const optionRows: {
  option: string;
  type: string;
  defaultValue: ReactNode;
  description: ReactNode;
}[] = [
  {
    option: 'appDirectory',
    type: 'string',
    defaultValue: <em>(required, first positional)</em>,
    description: (
      <>
        Directory the Convex app is created in, e.g.{' '}
        <Code>apps/my-backend</Code>.
      </>
    ),
  },
  {
    option: 'contractLibDirectory',
    type: 'string',
    defaultValue: <em>(required, second positional)</em>,
    description: (
      <>
        Directory the contract library is created in, e.g.{' '}
        <Code>libs/my-backend-kore</Code>.
      </>
    ),
  },
  {
    option: 'appName',
    type: 'string',
    defaultValue: (
      <>
        basename of <Code>appDirectory</Code>
      </>
    ),
    description: 'Nx project name for the Convex app.',
  },
  {
    option: 'contractLibName',
    type: 'string',
    defaultValue: (
      <>
        basename of <Code>contractLibDirectory</Code>
      </>
    ),
    description: 'Nx project name for the contract library.',
  },
  {
    option: 'importPath',
    type: 'string',
    defaultValue: <Code>contractLibName</Code>,
    description: (
      <>
        Package name used to import the Convex api, e.g.{' '}
        <Code>@myorg/my-backend-kore</Code>.
      </>
    ),
  },
  {
    option: 'enableAiFiles',
    type: 'boolean',
    defaultValue: <Code>false</Code>,
    description: (
      <>
        Enable Convex generated AI files, and add an{' '}
        <Code>update:ai-files</Code> target.
      </>
    ),
  },
  {
    option: 'deferConvexSetup',
    type: 'boolean',
    defaultValue: <Code>false</Code>,
    description: (
      <>
        Skip connecting to a Convex deployment; scaffold placeholder{' '}
        <Code>_generated</Code> files instead.
      </>
    ),
  },
];

const targets: { name: string; description: ReactNode }[] = [
  {
    name: 'serve',
    description: (
      <>
        runs <Code>convex dev</Code> and rebuilds the contract library whenever
        the generated files change, in parallel.
      </>
    ),
  },
  {
    name: 'build',
    description: 'typechecks the app and rebuilds the contract library.',
  },
  {
    name: 'convex',
    description: (
      <>
        forwards arbitrary commands to the Convex CLI, e.g.{' '}
        <Code>nx convex my-backend -- dev --once</Code>.
      </>
    ),
  },
  {
    name: 'deploy',
    description: (
      <>
        runs <Code>convex deploy</Code> from the app directory.
      </>
    ),
  },
  {
    name: 'clean',
    description: (
      <>
        removes <Code>dist</Code>, <Code>node_modules</Code>, and{' '}
        <Code>out-tsc</Code>.
      </>
    ),
  },
];

export default function NxConvex() {
  return (
    <main className="flex-1 px-6 py-8 md:px-10">
      <article className="mx-auto max-w-3xl">
        <h1>@wuguishifu/nx-convex</h1>

        <ExternalLink href="https://github.com/wuguishifu/generators">
          View on GitHub
        </ExternalLink>

        <p>
          An <ExternalLink href="https://nx.dev">Nx</ExternalLink> plugin that
          scaffolds a{' '}
          <ExternalLink href="https://convex.dev">Convex</ExternalLink> backend
          app together with a companion contract library inside an Nx workspace.
        </p>

        <p>
          Convex generates its client API types from your server source. In a
          monorepo that&apos;s awkward: any app that wants the nice{' '}
          <Code>api</Code> types ends up pulling the whole Convex server source
          graph into its TypeScript project. This plugin scaffolds two projects
          instead — the Convex app itself, and a small &quot;contract&quot;
          library that packages only the generated, client-safe artifacts (
          <Code>api</Code>, <Code>dataModel</Code>, and the declaration files
          they reference) into a <Code>dist/</Code> that other apps and libs can
          depend on.
        </p>

        <h2>Installation</h2>

        <CodeBlock>{installSnippet}</CodeBlock>

        <h2>Usage</h2>

        <CodeBlock>{usageSnippet}</CodeBlock>

        <p>
          The two positional arguments are the directory for the Convex app and
          the directory for the companion contract library. Project names
          default to the last segment of each path, and the contract
          library&apos;s import path defaults to its name. To set things
          explicitly:
        </p>

        <CodeBlock>{explicitUsageSnippet}</CodeBlock>

        <p>
          Add <Code>--dry-run</Code> to preview the changes without writing
          them.
        </p>

        <h3>Options</h3>

        <Table
          head={['Option', 'Type', 'Default', 'Description']}
          rows={optionRows.map((row) => [
            <Code key="option">{row.option}</Code>,
            row.type,
            row.defaultValue,
            row.description,
          ])}
        />

        <h2>What gets generated</h2>

        <CodeBlock>{generatedTree}</CodeBlock>

        <p>The Convex app gets these Nx targets:</p>

        <ul className="my-4 list-disc space-y-2 pl-6">
          {targets.map((target) => (
            <li key={target.name}>
              <strong>
                <Code>{target.name}</Code>
              </strong>{' '}
              — {target.description}
            </li>
          ))}
        </ul>

        <h2>After generation</h2>

        <p>
          The generator adds <Code>convex</Code> to the workspace{' '}
          <Code>package.json</Code>, runs <Code>nx sync</Code>, builds the app,
          and builds the contract library. Unless{' '}
          <Code>--deferConvexSetup</Code> is passed, it also runs{' '}
          <Code>convex dev --once</Code> first, which prompts you to log in and
          create or link a Convex deployment.
        </p>

        <p>
          Other projects then consume the backend&apos;s API through the
          contract library:
        </p>

        <CodeBlock>{consumeSnippet}</CodeBlock>

        <h2>Requirements</h2>

        <ul className="my-4 list-disc space-y-2 pl-6">
          <li>Node.js &gt;= 20</li>
          <li>
            Nx &gt;= 23 with the <Code>@nx/js/typescript</Code> plugin
          </li>
          <li>
            pnpm (the generator&apos;s post-install steps invoke{' '}
            <Code>pnpm nx ...</Code>)
          </li>
          <li>
            App and library directories two levels below the workspace root
            (e.g. <Code>apps/*</Code>, <Code>libs/*</Code>)
          </li>
        </ul>

        <h2>License</h2>

        <p>MIT</p>
      </article>
    </main>
  );
}
