// Run with `nx test platform-ffmpeg-contracts` (Node's built-in test runner; Node strips the types).
import { z } from 'zod';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ffmpegRequestSchema, parseArg, substituteArg } from './job.ts';

describe('parseArg', () => {
  it('finds placeholders with or without spaces inside the braces', () => {
    assert.deepEqual(parseArg('{{ in:clip }}').placeholders, [
      { kind: 'in', name: 'clip' },
    ]);
    assert.deepEqual(parseArg('{{out:trimmed}}').placeholders, [
      { kind: 'out', name: 'trimmed' },
    ]);
    assert.deepEqual(parseArg('{{  tmp:pass.log }}').placeholders, [
      { kind: 'tmp', name: 'pass.log' },
    ]);
  });

  it('finds placeholders inside an arg', () => {
    assert.deepEqual(
      parseArg('movie={{ in:logo }}[l];[0][l]overlay,subtitles={{in:subs}}')
        .placeholders,
      [
        { kind: 'in', name: 'logo' },
        { kind: 'in', name: 'subs' },
      ],
    );
  });

  it('leaves args without braces alone', () => {
    assert.deepEqual(parseArg('-c:v'), { placeholders: [], invalid: [] });
    assert.deepEqual(parseArg("drawtext=text='{x}'"), {
      placeholders: [],
      invalid: [],
    });
  });

  it('rejects malformed placeholders', () => {
    for (const arg of [
      '{{ in: clip }}',
      '{{ in :clip }}',
      '{{ foo:bar }}',
      '{{ in:bad/name }}',
      '{{ in:.. }}',
      '{{ in:.hidden }}',
      '{{ in }}',
      '{{}}',
      '{{ in:clip }',
      'x}}',
    ]) {
      assert.notEqual(parseArg(arg).invalid.length, 0, arg);
    }
  });
});

describe('substituteArg', () => {
  it('replaces every placeholder', () => {
    assert.equal(
      substituteArg(
        'subtitles={{ in:subs }}:force_style=1,{{tmp:x}}',
        ({ kind, name }) => `/work/${kind}/${name}`,
      ),
      'subtitles=/work/in/subs:force_style=1,/work/tmp/x',
    );
  });

  it('throws on a malformed placeholder', () => {
    assert.throws(() => substituteArg('{{ in: clip }}', () => 'x'));
  });
});

const trim = {
  inputs: { clip: { type: 's3', bucket: 'clipper', key: 'proxies/abc.mp4' } },
  outputs: { trimmed: { type: 's3', bucket: 'clipper', key: 'clips/abc.mp4' } },
  steps: [
    {
      args: [
        '-ss',
        '12.5',
        '-to',
        '41',
        '-i',
        '{{ in:clip }}',
        '-c:v',
        'h264_videotoolbox',
        '{{ out:trimmed }}',
      ],
    },
  ],
};

function issues(request: unknown): string[] {
  const result = ffmpegRequestSchema.safeParse(request);
  return result.success
    ? []
    : result.error.issues.map((issue) => issue.message);
}

describe('ffmpegRequestSchema', () => {
  it('accepts a trim', () => {
    assert.deepEqual(issues(trim), []);
  });

  it('accepts several steps passing scratch files', () => {
    assert.deepEqual(
      issues({
        ...trim,
        steps: [
          {
            args: [
              '-i',
              '{{ in:clip }}',
              '-pass',
              '1',
              '-passlogfile',
              '{{ tmp:pass }}',
              '-f',
              'null',
              '-',
            ],
          },
          {
            args: [
              '-i',
              '{{ in:clip }}',
              '-pass',
              '2',
              '-passlogfile',
              '{{ tmp:pass }}',
              '{{ out:trimmed }}',
            ],
          },
        ],
      }),
      [],
    );
  });

  it('accepts a job without inputs', () => {
    assert.deepEqual(
      issues({
        inputs: {},
        outputs: trim.outputs,
        steps: [
          {
            args: [
              '-f',
              'lavfi',
              '-i',
              'testsrc',
              '-t',
              '1',
              '{{ out:trimmed }}',
            ],
          },
        ],
      }),
      [],
    );
  });

  it('rejects undeclared inputs and outputs', () => {
    const messages = issues({
      ...trim,
      steps: [
        {
          args: [
            '-i',
            '{{ in:clip }}',
            '-i',
            '{{ in:other }}',
            '{{ out:trimmed }}',
            '{{ out:extra }}',
          ],
        },
      ],
    });
    assert.ok(messages.includes('No input named "other"'));
    assert.ok(messages.includes('No output named "extra"'));
  });

  it('rejects inputs no step reads and outputs no step writes', () => {
    const messages = issues({
      ...trim,
      inputs: {
        ...trim.inputs,
        unused: { type: 's3', bucket: 'b', key: 'k.mp4' },
      },
      outputs: {
        ...trim.outputs,
        never: { type: 's3', bucket: 'b', key: 'never.mp4' },
      },
    });
    assert.ok(messages.includes('No step reads input "unused"'));
    assert.ok(messages.includes('No step writes output "never"'));
  });

  it('rejects malformed placeholders', () => {
    const messages = issues({
      ...trim,
      steps: [
        {
          args: [
            '-i',
            '{{ in: clip }}',
            '-i',
            '{{ in:clip }}',
            '{{ out:trimmed }}',
          ],
        },
      ],
    });
    assert.ok(
      messages.some((message) => message.includes("isn't a placeholder")),
    );
  });

  it('rejects scratch names that differ only by case', () => {
    const messages = issues({
      ...trim,
      steps: [
        { args: ['-i', '{{ in:clip }}', '{{ tmp:Pass.log }}'] },
        {
          args: [
            '-i',
            '{{ tmp:pass.log }}',
            '{{ tmp:Pass.log }}',
            '{{ out:trimmed }}',
          ],
        },
      ],
    });
    assert.deepEqual(
      messages.filter((message) => message.includes('case-insensitive')),
      [
        'Scratch files "Pass.log" and "pass.log" would be one file on a case-insensitive disk',
      ],
    );
  });

  it('rejects two outputs to one object', () => {
    const messages = issues({
      ...trim,
      outputs: { ...trim.outputs, copy: trim.outputs.trimmed },
      steps: [
        {
          args: ['-i', '{{ in:clip }}', '{{ out:trimmed }}', '{{ out:copy }}'],
        },
      ],
    });
    assert.ok(
      messages.some((message) =>
        message.includes('are both s3://clipper/clips/abc.mp4'),
      ),
    );
  });

  it('rejects bad names, no outputs and no steps', () => {
    assert.notDeepEqual(
      issues({ ...trim, inputs: { '../x': trim.inputs.clip } }),
      [],
    );
    assert.notDeepEqual(issues({ ...trim, outputs: {} }), []);
    assert.notDeepEqual(issues({ ...trim, steps: [] }), []);
  });

  it('types the parsed request', () => {
    const request: z.infer<typeof ffmpegRequestSchema> =
      ffmpegRequestSchema.parse(trim);
    assert.equal(request.inputs['clip']?.key, 'proxies/abc.mp4');
  });
});
