import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { mkdir, mkdtemp, readdir, rm } from 'fs/promises';
import path from 'path';

import { EnvironmentService } from '../../config/environment';

/** Only entries named like this are ever deleted, so a misconfigured work dir loses nothing else. */
const JOB_DIR_PREFIX = 'job-';

/** Each job gets its own dir, with `in`, `out` and `tmp` in it, deleted when the job ends. */
@Injectable()
export class WorkDirService implements OnModuleInit {
  private readonly logger = new Logger(WorkDirService.name);

  constructor(private readonly environmentService: EnvironmentService) {}

  private get root() {
    return this.environmentService.environment.ffmpegWorkDir;
  }

  /** Deletes dirs left by jobs that were running when the worker last stopped. */
  async onModuleInit() {
    await mkdir(this.root, { recursive: true });
    const leftovers = (await readdir(this.root)).filter((name) =>
      name.startsWith(JOB_DIR_PREFIX),
    );
    await Promise.all(
      leftovers.map((name) =>
        rm(path.join(this.root, name), { recursive: true, force: true }),
      ),
    );
    if (leftovers.length) {
      this.logger.log(`Deleted ${leftovers.length} leftover work dirs`);
    }
  }

  public async create(): Promise<string> {
    const dir = await mkdtemp(path.join(this.root, JOB_DIR_PREFIX));
    await Promise.all(
      ['in', 'out', 'tmp'].map((sub) => mkdir(path.join(dir, sub))),
    );
    return dir;
  }

  public async remove(dir: string) {
    await rm(dir, { recursive: true, force: true });
  }
}
