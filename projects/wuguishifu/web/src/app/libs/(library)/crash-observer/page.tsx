import type { ReactNode } from 'react';

import { Code, CodeBlock } from '../../../../components/code';
import { ExternalLink } from '../../../../components/external-link';
import { Table } from '../../../../components/table';

const NPM_URL = 'https://www.npmjs.com/package/@wuguishifu/crash-observer';

const installSnippet = `npm install @wuguishifu/crash-observer
# or
pnpm add @wuguishifu/crash-observer`;

const rebuildSnippet = `npx expo prebuild
npx expo run:ios    # or run-android`;

const usageSnippet = `import * as CrashObserver from '@wuguishifu/crash-observer';

// at app startup
CrashObserver.start({
  onReport: async (report) => {
    // plug in your own transport - throwing keeps the report for a retry
    await myLogger.send('native-crash', report);
  },
});

// attach whatever identifies the session in your system
CrashObserver.setContext({
  userId: user.id,
  sessionId,
});

// leave a trail for debugging
CrashObserver.addBreadcrumb({
  message: 'opened reader',
  category: 'navigation',
});`;

const apiRows: { fn: string; description: ReactNode }[] = [
  {
    fn: 'start(options)',
    description: (
      <>
        Installs crash handlers and delivers pending reports to{' '}
        <Code>options.onReport</Code>.
      </>
    ),
  },
  {
    fn: 'flushPendingReports(handler?)',
    description: 'Re-runs delivery (e.g. after connectivity returns).',
  },
  {
    fn: 'getPendingReports()',
    description: 'Returns undelivered reports without deleting them.',
  },
  {
    fn: 'deleteReport(id) / deleteAllReports()',
    description: 'Manual cleanup if you manage delivery yourself.',
  },
  {
    fn: 'setContext(values) / clearContext()',
    description: 'Key-value context attached to future reports.',
  },
  {
    fn: 'addBreadcrumb(crumb) / clearBreadcrumbs()',
    description: 'Breadcrumb trail attached to future reports.',
  },
  {
    fn: 'simulateCrash(type?)',
    description:
      'Actually crashes the app to test the pipeline. Test builds only.',
  },
];

export default function CrashObserver() {
  return (
    <main className="flex-1 px-6 py-8 md:px-10">
      <article className="mx-auto max-w-3xl">
        <h1>@wuguishifu/crash-observer</h1>

        <ExternalLink href="https://github.com/wuguishifu/crash-observer">
          View on GitHub
        </ExternalLink>

        <p>
          <ExternalLink href={NPM_URL}>
            <Code>@wuguishifu/crash-observer</Code>
          </ExternalLink>{' '}
          is an{' '}
          <ExternalLink href="https://docs.expo.dev/modules/">
            Expo native module
          </ExternalLink>{' '}
          that captures crashes at the native layer — uncaught exceptions and
          (optionally) POSIX signals — and delivers them to{' '}
          <strong>your</strong> logging system on the next launch.
        </p>

        <p>
          Unlike Sentry/Crashlytics-style SDKs, this library has no networking
          and no opinions about where reports go. A native crash kills the
          process, so a report can&apos;t reliably be sent in-process anyway —
          instead the native layer persists each crash as a file in app-private
          storage, and on the next launch your JS handler receives the pending
          reports and sends them wherever you like: your analytics pipeline, a
          plain HTTP endpoint, anything.
        </p>

        <h2>Installation</h2>

        <CodeBlock>{installSnippet}</CodeBlock>

        <p>
          Requires an Expo project (bare or prebuild workflow — the native
          module is autolinked by Expo Modules). After installing, rebuild the
          native app:
        </p>

        <CodeBlock>{rebuildSnippet}</CodeBlock>

        <h2>Usage</h2>

        <CodeBlock>{usageSnippet}</CodeBlock>

        <h3>Delivery semantics</h3>

        <ul className="my-4 list-disc space-y-2 pl-6">
          <li>
            Reports are written to disk at crash time, one file per crash —
            multiple undelivered crashes don&apos;t overwrite each other.
          </li>
          <li>
            On <Code>start({'{ onReport }'})</Code>, every pending report is
            passed to your handler, oldest first.
          </li>
          <li>
            Handler resolves → the report is deleted. Handler throws → the
            report is kept and retried on the next <Code>start</Code> or{' '}
            <Code>flushPendingReports</Code> call. Delivery is at-least-once, so
            make your sink idempotent (<Code>report.id</Code> is stable).
          </li>
          <li>
            <Code>start()</Code> resolves after delivery finishes; call it
            without <Code>await</Code> if you don&apos;t want delivery to block
            startup.
          </li>
        </ul>

        <h3>API overview</h3>

        <Table
          head={['Function', 'Description']}
          rows={apiRows.map((row) => [
            <Code key="fn">{row.fn}</Code>,
            row.description,
          ])}
        />

        <p>
          See the <ExternalLink href={NPM_URL}>package README</ExternalLink> for
          the full API, <Code>CrashReport</Code> shape,{' '}
          <Code>StartOptions</Code>, and the list of things this library
          deliberately does not do (JS error handling, symbolication,
          watchdog/OOM kills).
        </p>
      </article>
    </main>
  );
}
