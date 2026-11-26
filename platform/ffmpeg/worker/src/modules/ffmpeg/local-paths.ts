// Only type imports from the contracts, so the spec can run this file on Node's type stripping.
import path from 'node:path';

import type { FfmpegRequest, Placeholder } from '@platform/ffmpeg-contracts';

/**
 * Where a job's files live in its work dir: `in/<name><ext>` and `out/<name><ext>` (the S3 key's
 * extension, since ffmpeg picks formats by it) and `tmp/<name>`.
 */
export class LocalPaths {
  readonly workDir: string;
  private readonly request: Pick<FfmpegRequest, 'inputs' | 'outputs'>;

  constructor(
    workDir: string,
    request: Pick<FfmpegRequest, 'inputs' | 'outputs'>,
  ) {
    this.workDir = workDir;
    this.request = request;
    const kinds: ('in' | 'out')[] = ['in', 'out'];
    for (const kind of kinds) {
      const names = Object.keys(
        kind === 'in' ? request.inputs : request.outputs,
      );
      const files = new Map<string, string>();
      for (const name of names) {
        const file = this.resolve({ kind, name });
        const other = files.get(file);
        if (other) {
          throw new Error(
            `"${other}" and "${name}" would both be ${path.relative(workDir, file)}; rename one`,
          );
        }
        files.set(file, name);
      }
    }
  }

  resolve({ kind, name }: Placeholder): string {
    if (kind === 'tmp') return path.join(this.workDir, 'tmp', name);
    const object =
      kind === 'in' ? this.request.inputs[name] : this.request.outputs[name];
    if (!object) {
      throw new Error(
        `No ${kind === 'in' ? 'input' : 'output'} named "${name}"`,
      );
    }
    return path.join(this.workDir, kind, name + path.posix.extname(object.key));
  }

  input(name: string): string {
    return this.resolve({ kind: 'in', name });
  }

  output(name: string): string {
    return this.resolve({ kind: 'out', name });
  }

  /** For logs: paths relative to the work dir, which is ffmpeg's working directory. */
  relative(arg: string): string {
    return arg.replaceAll(`${this.workDir}${path.sep}`, '');
  }
}
