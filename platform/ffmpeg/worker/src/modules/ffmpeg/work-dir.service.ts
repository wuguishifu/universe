import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { mkdir, mkdtemp, readdir, rm } from 'fs/promises';
import path from 'path';

import { EnvironmentService } from '../../config/environment';

/**
 * Each worker process works in `<FFMPEG_WORK_DIR>/worker-<pid>`, so workers sharing a work dir
 * (e.g. two in dev) never delete each other's files. Only entries named like this are ever
 * deleted, so a misconfigured work dir loses nothing else.
 */
const WORKER_DIR_PREFIX = 'worker-';
const JOB_DIR_PREFIX = 'job-';

/** Each job gets its own dir, with `in`, `out` and `tmp` in it, deleted when the job ends. */
@Injectable()
export class WorkDirService implements OnModuleInit {
  private readonly logger = new Logger(WorkDirService.name);
  /** Absolute, since ffmpeg runs in a job's dir: a relative one would be applied twice. */
  private readonly root: string;
  private readonly workerDir: string;

  constructor(environmentService: EnvironmentService) {
    this.root = path.resolve(environmentService.environment.ffmpegWorkDir);
    this.workerDir = path.join(this.root, `${WORKER_DIR_PREFIX}${process.pid}`);
  }

  /**
   * Deletes what workers that have since stopped left behind, including a previous process with
   * this one's PID, then makes this worker's dir.
   */
  async onModuleInit() {
    await mkdir(this.root, { recursive: true });
    const leftovers = (await readdir(this.root)).filter((name) => {
      if (!name.startsWith(WORKER_DIR_PREFIX)) return false;
      const pid = Number(name.slice(WORKER_DIR_PREFIX.length));
      return pid === process.pid || !isRunning(pid);
    });
    await Promise.all(
      leftovers.map((name) =>
        rm(path.join(this.root, name), { recursive: true, force: true }),
      ),
    );
    if (leftovers.length) {
      this.logger.log(
        `Deleted the work dirs of ${leftovers.length} stopped worker(s)`,
      );
    }
    await mkdir(this.workerDir);
  }

  public async create(): Promise<string> {
    const dir = await mkdtemp(path.join(this.workerDir, JOB_DIR_PREFIX));
    await Promise.all(
      ['in', 'out', 'tmp'].map((sub) => mkdir(path.join(dir, sub))),
    );
    return dir;
  }

  public async remove(dir: string) {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Whether a process with this PID exists. A reused PID keeps a dead worker's dir until that
 * process ends, which only costs disk space.
 */
function isRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists, under another user.
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}
