// Run with `nx test ffmpeg-worker` (Node's built-in test runner; Node strips the types).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { contentTypeFor } from './content-type.ts';
import { isTransientFailure, tail } from './errors.ts';
import { LocalPaths } from './local-paths.ts';
import { toProbe } from './probe.ts';
import {
  createProgressParser,
  ProgressTracker,
  stepFraction,
} from './progress.ts';

describe('LocalPaths', () => {
  const s3 = (key: string) => ({ type: 's3' as const, bucket: 'b', key });
  const paths = new LocalPaths('/work/job-1', {
    inputs: { clip: s3('proxies/abc.mp4'), subs: s3('subs/abc.en.srt') },
    outputs: { trimmed: s3('clips/abc.mp4'), raw: s3('raw/no-extension') },
  });

  it("keeps the key's extension for inputs and outputs", () => {
    assert.equal(paths.input('clip'), '/work/job-1/in/clip.mp4');
    assert.equal(paths.input('subs'), '/work/job-1/in/subs.srt');
    assert.equal(paths.output('trimmed'), '/work/job-1/out/trimmed.mp4');
    assert.equal(paths.output('raw'), '/work/job-1/out/raw');
  });

  it('puts scratch files in tmp', () => {
    assert.equal(
      paths.resolve({ kind: 'tmp', name: 'pass.log' }),
      '/work/job-1/tmp/pass.log',
    );
  });

  it('throws for undeclared names', () => {
    assert.throws(() => paths.input('nope'), /No input named "nope"/);
  });

  it('rejects two names that would be one file', () => {
    assert.throws(
      () =>
        new LocalPaths('/work', {
          inputs: { a: s3('x.mp4'), 'a.mp4': s3('y') },
          outputs: {},
        }),
      /would both be in\/a\.mp4/,
    );
  });

  it('shows args relative to the work dir', () => {
    assert.equal(
      paths.relative('subtitles=/work/job-1/in/subs.srt'),
      'subtitles=in/subs.srt',
    );
  });
});

describe('createProgressParser', () => {
  it('reads out_time_us across chunks', () => {
    const times: number[] = [];
    const parse = createProgressParser((ms) => times.push(ms));
    parse('frame=10\nout_time_us=1500');
    parse('000\nout_time_ms=1500000\nout_time_us=N/A\nprogress=continue\n');
    parse('out_time_us=2250000\nprogress=end\n');
    assert.deepEqual(times, [1500, 2250]);
  });
});

describe('ProgressTracker', () => {
  it('maps phases onto 0-100 and throttles within a phase', () => {
    let now = 0;
    const reported: number[] = [];
    const tracker = new ProgressTracker(
      2,
      (p) => reported.push(p),
      1000,
      () => now,
    );
    tracker.download(0);
    tracker.download(1);
    tracker.step(0, 0);
    now = 500;
    tracker.step(0, 0.5); // throttled
    now = 1500;
    tracker.step(0, 0.5);
    tracker.step(1, 0);
    now = 3000;
    tracker.step(1, 5); // a bad guess at the duration stops short of the next phase
    tracker.upload(0);
    tracker.done();
    assert.deepEqual(reported, [0, 5, 27, 50, 94, 95, 100]);
  });

  it('only falls back to 0 without an expected duration', () => {
    assert.equal(stepFraction(1000, 4000), 0.25);
    assert.equal(stepFraction(1000, undefined), 0);
  });
});

describe('isTransientFailure', () => {
  it('retries VideoToolbox session failures', () => {
    assert.ok(
      isTransientFailure(
        '[h264_videotoolbox @ 0x1] Error: cannot create compression session: -12902',
      ),
    );
    assert.ok(isTransientFailure('Error encoding frame: -12911'));
  });

  it("doesn't retry bad args or input", () => {
    assert.ok(
      !isTransientFailure(
        'in/clip.mp4: Invalid data found when processing input',
      ),
    );
    assert.ok(!isTransientFailure("Unrecognized option 'foo'."));
  });

  it('keeps the last non-empty lines', () => {
    assert.equal(tail('a\n\nb\r\nc\rd\n', 2), 'c\nd');
  });
});

describe('toProbe', () => {
  it('keeps duration, format and stream details', () => {
    const probe = toProbe(
      JSON.stringify({
        format: {
          format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
          duration: '28.512000',
        },
        streams: [
          {
            index: 0,
            codec_type: 'video',
            codec_name: 'h264',
            width: 1920,
            height: 1080,
            avg_frame_rate: '30000/1001',
          },
          {
            index: 1,
            codec_type: 'audio',
            codec_name: 'aac',
            sample_rate: '48000',
            channels: 2,
            avg_frame_rate: '0/0',
          },
        ],
      }),
    );
    assert.deepEqual(probe, {
      durationMs: 28512,
      format: 'mov,mp4,m4a,3gp,3g2,mj2',
      streams: [
        {
          index: 0,
          type: 'video',
          codec: 'h264',
          width: 1920,
          height: 1080,
          fps: 29.97,
          sampleRate: undefined,
          channels: undefined,
        },
        {
          index: 1,
          type: 'audio',
          codec: 'aac',
          width: undefined,
          height: undefined,
          fps: undefined,
          sampleRate: 48000,
          channels: 2,
        },
      ],
    });
  });

  it('handles an image without a duration', () => {
    const probe = toProbe(
      JSON.stringify({
        format: { format_name: 'png_pipe' },
        streams: [
          {
            index: 0,
            codec_type: 'video',
            codec_name: 'png',
            avg_frame_rate: '0/0',
            r_frame_rate: '25/1',
          },
        ],
      }),
    );
    assert.equal(probe.durationMs, undefined);
    assert.equal(probe.streams[0]?.fps, 25);
  });
});

describe('contentTypeFor', () => {
  it('goes by the extension', () => {
    assert.equal(contentTypeFor('clips/abc.MP4'), 'video/mp4');
    assert.equal(contentTypeFor('a/b.m3u8'), 'application/vnd.apple.mpegurl');
    assert.equal(
      contentTypeFor('raw/no-extension'),
      'application/octet-stream',
    );
  });
});
