import { Injectable } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { cleanErrorOutput } from '@projects/mega-client-contracts';
import { EnvironmentService } from '../../config/environment';

/** A MEGAcmd command that failed, with what MEGAcmd said about it. */
export class MegaCliError extends Error {}

/**
 * Runs MEGAcmd commands through `mega-exec`, which talks to the mega-cmd-server that the image's
 * entrypoint starts (any command starts it if it isn't running).
 */
@Injectable()
export class MegaCliService {
  constructor(private readonly environmentService: EnvironmentService) {}

  /**
   * stdout of `mega-exec ...args`. No shell is involved, but MEGAcmd parses anything starting with
   * "-" as an option, so arguments from users have to be validated before they get here.
   */
  public run(args: string[], { timeoutMs = 30_000 } = {}): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        this.environmentService.environment.megaExec,
        args,
        { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (!error) return resolve(stdout);
          reject(
            new MegaCliError(
              cleanErrorOutput(stderr) ||
                cleanErrorOutput(stdout) ||
                error.message,
              { cause: error },
            ),
          );
        },
      );
    });
  }
}
