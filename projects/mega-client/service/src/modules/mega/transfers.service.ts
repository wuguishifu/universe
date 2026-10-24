import { Injectable } from '@nestjs/common';
import { posix } from 'node:path';
import {
  COLUMN_SEPARATOR,
  etaSeconds,
  isFinished,
  type ParsedTransfer,
  parseTransfers,
  type Transfer,
  TRANSFER_COLUMNS,
  TransferRates,
  TransferState,
} from '@projects/mega-client-contracts';
import { EnvironmentService } from '../../environment/environment';
import { MegaCliService } from './mega-cli.service';

/** How many finished transfers stay in the list, newest first. */
const FINISHED_SHOWN = 10;

const listArgs = [
  'transfers',
  '--show-completed',
  // --limit counts finished transfers too, and is 10 when left out.
  '--limit=1000',
  '--path-display-size=1000',
  `--col-separator=${COLUMN_SEPARATOR}`,
  `--output-cols=${TRANSFER_COLUMNS.join(',')}`,
];

const byTag = (a: ParsedTransfer, b: ParsedTransfer) =>
  Number(a.tag) - Number(b.tag);

const bytesDone = ({ percent, totalBytes }: ParsedTransfer) =>
  totalBytes === null ? null : (percent / 100) * totalBytes;

@Injectable()
export class TransfersService {
  private readonly rates = new TransferRates();

  constructor(
    private readonly megaCli: MegaCliService,
    private readonly environmentService: EnvironmentService,
  ) {}

  /** Unfinished transfers in queue order (tags only go up), then the newest finished ones. */
  public async list(): Promise<Transfer[]> {
    const parsed = parseTransfers(await this.megaCli.run(listArgs));

    this.rates.record(
      Date.now(),
      parsed.flatMap((transfer) => {
        const bytes = bytesDone(transfer);
        return bytes === null
          ? []
          : [
              {
                tag: transfer.tag,
                bytes,
                moving: transfer.state === TransferState.Active,
              },
            ];
      }),
    );

    const unfinished = parsed
      .filter(({ state }) => !isFinished(state))
      .sort(byTag);
    const finished = parsed
      .filter(({ state }) => isFinished(state))
      .sort((a, b) => byTag(b, a))
      .slice(0, FINISHED_SHOWN);

    return [...unfinished, ...finished].map((transfer) => {
      const bytesPerSecond =
        transfer.state === TransferState.Active
          ? this.rates.bytesPerSecond(transfer.tag)
          : null;
      const bytes = bytesDone(transfer);
      return {
        ...transfer,
        name:
          posix.basename(transfer.destinationPath || transfer.sourcePath) ||
          transfer.sourcePath,
        bytesPerSecond,
        etaSeconds:
          bytes === null || transfer.totalBytes === null
            ? null
            : etaSeconds(transfer.totalBytes - bytes, bytesPerSecond),
      };
    });
  }

  /** `url` has to be a MEGA link (see the contract): anything starting with "-" is an option. */
  public async queue(url: string): Promise<void> {
    await this.megaCli.run([
      'get',
      '-q',
      url,
      this.environmentService.environment.downloadPath,
    ]);
  }

  public async pause(tag: string): Promise<void> {
    await this.megaCli.run(['transfers', '-p', tag]);
  }

  public async resume(tag: string): Promise<void> {
    await this.megaCli.run(['transfers', '-r', tag]);
  }

  public async cancel(tag: string): Promise<void> {
    await this.megaCli.run(['transfers', '-c', tag]);
  }

  public async pauseAll(): Promise<void> {
    await this.megaCli.run(['transfers', '-p', '-a']);
  }

  public async resumeAll(): Promise<void> {
    await this.megaCli.run(['transfers', '-r', '-a']);
  }
}
