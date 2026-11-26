// Run with `nx test queue` (Node's built-in test runner; Node strips the types).
import type { FlowJob } from 'bullmq';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { withIdempotencyKey } from './flow-tree.ts';

const job = (queueName: string, prefix?: string, jobId?: string) => ({
  name: 'job',
  queueName,
  prefix,
  opts: jobId ? { jobId } : undefined,
});

const flow: FlowJob = {
  ...job('parent-queue'),
  children: [
    {
      ...job('transcription-queue', 'transcription-worker-queue'),
      children: [job('ffmpeg-queue', 'ffmpeg-worker-queue')],
    },
  ],
};

describe('withIdempotencyKey', () => {
  it('gives every job in the tree the key as its ID', () => {
    const result = withIdempotencyKey(flow, 'clip-1');
    assert.equal(result.opts?.jobId, 'clip-1');
    const [transcription] = result.children ?? [];
    assert.equal(transcription?.opts?.jobId, 'clip-1');
    assert.equal(transcription?.children?.[0]?.opts?.jobId, 'clip-1');
  });

  it("keeps a job's own ID", () => {
    const result = withIdempotencyKey(
      {
        ...job('parent-queue'),
        children: [job('ffmpeg-queue', 'ffmpeg-worker-queue', 'own')],
      },
      'clip-1',
    );
    assert.equal(result.children?.[0]?.opts?.jobId, 'own');
  });

  it('leaves IDs unset without a key', () => {
    const result = withIdempotencyKey(flow, undefined);
    assert.equal(result.opts?.jobId, undefined);
    assert.equal(result.children?.[0]?.children?.[0]?.opts?.jobId, undefined);
  });

  it('rejects two jobs with one ID in the same queue', () => {
    assert.throws(
      () =>
        withIdempotencyKey(
          {
            ...job('parent-queue'),
            children: [
              {
                ...job('ffmpeg-queue', 'ffmpeg-worker-queue'),
                children: [job('ffmpeg-queue', 'ffmpeg-worker-queue')],
              },
            ],
          },
          'clip-1',
        ),
      /two jobs with ID clip-1 in queue ffmpeg-queue/,
    );
  });

  it('allows one ID in the same-named queue under different prefixes', () => {
    assert.doesNotThrow(() =>
      withIdempotencyKey(
        { ...job('jobs', 'a'), children: [job('jobs', 'b')] },
        'clip-1',
      ),
    );
  });
});
