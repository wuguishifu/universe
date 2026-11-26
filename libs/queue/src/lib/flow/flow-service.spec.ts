// Run with `nx test queue` (Node's built-in test runner; Node strips the types).
import { z } from 'zod';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  defineFlowService,
  FlowChildFailedError,
  type FlowParentJobHandle,
} from './flow-service.ts';

const CONFIG = {
  echo: {
    queueName: 'echo-queue',
    jobName: 'echo',
    jobSchema: z.object({ text: z.string().min(1) }),
    resultsSchema: z.object({ text: z.string() }),
  },
};

class EchoFailedError extends FlowChildFailedError {
  override readonly name = 'EchoFailedError';
}

const echo = defineFlowService({
  label: 'echo',
  prefix: 'echo-worker-queue',
  queue: CONFIG.echo,
  defaultJobOptions: { attempts: 3 },
  failedError: EchoFailedError,
});

const parentJob = (
  values: Record<string, unknown>,
  failures: Record<string, string> = {},
): FlowParentJobHandle => ({
  id: 'parent-1',
  getChildrenValues: () => Promise.resolve(values),
  getIgnoredChildrenFailures: () => Promise.resolve(failures),
});

describe('child', () => {
  it('builds a leaf job in the service queue with its default options', () => {
    assert.deepEqual(echo.child({ text: 'hi' }), {
      name: 'echo',
      queueName: 'echo-queue',
      prefix: 'echo-worker-queue',
      data: { text: 'hi' },
      opts: { attempts: 3, failParentOnFailure: true },
    });
  });

  it('lets the caller override options and run the parent on failure', () => {
    const { opts } = echo.child(
      { text: 'hi' },
      { attempts: 1, onFailure: 'run-parent' },
    );
    assert.deepEqual(opts, { attempts: 1, ignoreDependencyOnFailure: true });
  });

  it('nests children under the job', () => {
    const inner = echo.child({ text: 'first' });
    const node = echo.child({ text: 'second' }, { children: [inner] });
    assert.deepEqual(node.children, [inner]);
    assert.equal(
      'children' in echo.child({ text: 'x' }, { children: [] }),
      false,
    );
  });

  it('rejects an invalid request', () => {
    assert.throws(() => echo.child({ text: '' }), /Invalid echo request/);
  });
});

describe('getResult', () => {
  it("reads the service's child among others", async () => {
    const result = await echo.getResult(
      parentJob({
        'echo-worker-queue:echo-queue:abc': { text: 'hi' },
        'other-queue:other:abc': { unrelated: true },
      }),
    );
    assert.deepEqual(result, { text: 'hi' });
  });

  it('rejects a result that fails the results schema', async () => {
    await assert.rejects(
      echo.getResult(parentJob({ 'echo-worker-queue:echo-queue:abc': {} })),
      /Invalid echo result/,
    );
  });

  it("throws the service's error for an ignored failure", async () => {
    const error = await echo
      .getResult(
        parentJob({}, { 'echo-worker-queue:echo-queue:abc': 'it broke' }),
      )
      .catch((e: unknown) => e);
    assert.ok(error instanceof EchoFailedError);
    assert.ok(error instanceof FlowChildFailedError);
    assert.equal(error.name, 'EchoFailedError');
    assert.equal(error.message, 'it broke');
    assert.equal(error.childKey, 'echo-worker-queue:echo-queue:abc');
  });

  it('throws with more than one child of the service', async () => {
    await assert.rejects(
      echo.getResult(
        parentJob({
          'echo-worker-queue:echo-queue:a': { text: 'a' },
          'echo-worker-queue:echo-queue:b': { text: 'b' },
        }),
      ),
      /has 2 echo children/,
    );
  });

  it('throws without a child of the service', async () => {
    await assert.rejects(
      echo.getResult(parentJob({ 'other-queue:other:abc': {} })),
      /has no echo result/,
    );
  });
});
