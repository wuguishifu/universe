import type { ReactNode } from 'react';

import { Code, CodeBlock } from '../../../../components/code';
import { ExternalLink } from '../../../../components/external-link';
import { Table } from '../../../../components/table';

// note: `${{ ... }}` GitHub expressions are escaped as `\${{ ... }}` so they
// aren't treated as template literal interpolation.

const versionBumpSnippet = `- uses: actions/checkout@v4

- name: bump version
  id: version
  uses: wuguishifu/version-bump-workflow@v1
  with:
    bump-type: \${{ inputs.version-bump-type }}`;

const setPackageVersionSnippet = `- uses: wuguishifu/version-bump-workflow/set-package-version@v1
  with:
    version: \${{ needs.version.outputs.version }}
    path: package.json # default`;

const dockerImageSnippet = `- name: docker image
  id: docker
  uses: wuguishifu/version-bump-workflow/docker-image@v1
  with:
    version: \${{ steps.version.outputs.tag }}
    image: wuguishifu/my-application
    registry: ghcr.io # default

- run: |
    docker build -t \${{ steps.docker.outputs.image }} -t \${{ steps.docker.outputs.image-latest }} .
    docker push \${{ steps.docker.outputs.image }}
    docker push \${{ steps.docker.outputs.image-latest }}`;

const singlePackageSnippet = `jobs:
  version:
    runs-on: ubuntu-latest
    outputs:
      version: \${{ steps.version.outputs.version }}
      tag: \${{ steps.version.outputs.tag }}
    steps:
      - uses: actions/checkout@v4
      - id: version
        uses: wuguishifu/version-bump-workflow@v1
        with:
          bump-type: \${{ inputs.version-bump-type }}

  build:
    needs: version
    steps:
      - uses: actions/checkout@v4
      - uses: wuguishifu/version-bump-workflow/set-package-version@v1
        with:
          version: \${{ needs.version.outputs.version }}
      # ... build

  release:
    needs: [version, build]
    permissions:
      contents: write
    steps:
      - uses: softprops/action-gh-release@v2
        with:
          tag_name: \${{ needs.version.outputs.tag }}`;

const monorepoSnippet = `- id: version
  uses: wuguishifu/version-bump-workflow@v1
  with:
    bump-type: \${{ inputs.version-bump-type }}
    tag-prefix: \${{ inputs.app }}-v

- id: docker
  uses: wuguishifu/version-bump-workflow/docker-image@v1
  with:
    version: \${{ steps.version.outputs.tag }}
    image: \${{ steps.config.outputs.registry_path }}

# ... build and push

- run: gh release create "\${{ steps.version.outputs.tag }}" --target "$GITHUB_SHA" --latest=false`;

const actionRows: ReactNode[][] = [
  [
    <Code key="a">wuguishifu/version-bump-workflow@v1</Code>,
    'Computes the next version from the latest tag',
  ],
  [
    <Code key="a">
      wuguishifu/version-bump-workflow/set-package-version@v1
    </Code>,
    <>
      Writes a version into <Code>package.json</Code>, preserving its formatting
    </>,
  ],
  [
    <Code key="a">wuguishifu/version-bump-workflow/docker-image@v1</Code>,
    <>
      Builds{' '}
      <Code>&lt;registry&gt;/&lt;image&gt;:&lt;version&gt;-&lt;sha&gt;</Code>{' '}
      and <Code>:latest</Code> refs
    </>,
  ],
];

const inputRows: ReactNode[][] = [
  [
    <Code key="a">bump-type</Code>,
    <Code key="b">patch</Code>,
    <>
      <Code>major</Code>, <Code>minor</Code> or <Code>patch</Code>
    </>,
  ],
  [
    <Code key="a">tag-prefix</Code>,
    <Code key="b">v</Code>,
    <>
      Prefix in front of <Code>X.Y.Z</Code>, e.g. <Code>my-application-v</Code>{' '}
      for per-app tags in a monorepo. May be empty
    </>,
  ],
  [
    <Code key="a">initial-version</Code>,
    <Code key="b">0.0.0</Code>,
    <>
      Version to bump from when no matching tag exists, so the first{' '}
      <Code>major</Code> is <Code>1.0.0</Code>
    </>,
  ],
  [
    <Code key="a">remote</Code>,
    <Code key="b">origin</Code>,
    'Git remote to read tags from',
  ],
];

const outputRows: ReactNode[][] = [
  [<Code key="a">version</Code>, <Code key="b">1.2.3</Code>],
  [<Code key="a">tag</Code>, <Code key="b">v1.2.3</Code>],
  [
    <Code key="a">previous-version</Code>,
    <>
      <Code>1.2.2</Code> (empty if there was no tag)
    </>,
  ],
  [
    <Code key="a">previous-tag</Code>,
    <>
      <Code>v1.2.2</Code> (empty if there was no tag)
    </>,
  ],
];

export default function VersionBumpWorkflow() {
  return (
    <main className="flex-1 px-6 py-8 md:px-10">
      <article className="mx-auto max-w-3xl">
        <h1>wuguishifu/version-bump-workflow</h1>

        <ExternalLink href="https://github.com/wuguishifu/version-bump-workflow">
          View on GitHub
        </ExternalLink>

        <p>
          Reusable GitHub Actions for tag-based semver releases. The version
          lives only in git tags: each release reads the latest{' '}
          <Code>&lt;prefix&gt;X.Y.Z</Code> tag on the remote, bumps it, and
          whatever creates the release (<Code>gh release create</Code>,{' '}
          <Code>softprops/action-gh-release</Code>, ...) creates the new tag.
        </p>

        <Table head={['Action', 'What it does']} rows={actionRows} />

        <h2>Version bump</h2>

        <CodeBlock>{versionBumpSnippet}</CodeBlock>

        <p>
          The repo must be checked out first (tags are read with{' '}
          <Code>git ls-remote origin</Code>, so a shallow checkout is fine). The
          job that creates the release needs <Code>contents: write</Code>.
        </p>

        <Table head={['Input', 'Default', 'Description']} rows={inputRows} />

        <Table head={['Output', 'Example']} rows={outputRows} />

        <p>
          Only tags that are exactly <Code>&lt;prefix&gt;X.Y.Z</Code> count:
          pre-release tags like <Code>v2.0.0-beta</Code> and tags from other
          prefixes like <Code>my-application-v1.0.0</Code> (when the prefix is{' '}
          <Code>v</Code>) are ignored.
        </p>

        <h2>Set package version</h2>

        <CodeBlock>{setPackageVersionSnippet}</CodeBlock>

        <p>
          Fails if the file has no top-level <Code>&quot;version&quot;</Code>{' '}
          field.
        </p>

        <h2>Docker image</h2>

        <CodeBlock>{dockerImageSnippet}</CodeBlock>

        <p>
          Outputs <Code>tag</Code> (<Code>my-application-v1.2.3-abcd1234</Code>
          ), <Code>image</Code> (
          <Code>
            ghcr.io/wuguishifu/my-application:my-application-v1.2.3-abcd1234
          </Code>
          ), <Code>image-latest</Code> (
          <Code>ghcr.io/wuguishifu/my-application:latest</Code>) and{' '}
          <Code>image-name</Code> (
          <Code>ghcr.io/wuguishifu/my-application</Code>). The image name is
          lowercased.
        </p>

        <h2>Examples</h2>

        <h3>Single-package app with binaries</h3>

        <CodeBlock>{singlePackageSnippet}</CodeBlock>

        <h3>Monorepo with per-app tags</h3>

        <CodeBlock>{monorepoSnippet}</CodeBlock>
      </article>
    </main>
  );
}
