// No imports, so `nx test mega-client-contracts` can load this with Node's type stripping.

/**
 * Put between the columns of `mega-exec transfers` (with --col-separator), so paths with spaces
 * can't be mistaken for column breaks the way they could in its space-aligned output.
 */
export const COLUMN_SEPARATOR = '|~|';

/** The columns asked for with --output-cols, in this order. */
export const TRANSFER_COLUMNS = [
  'TYPE',
  'TAG',
  'SOURCEPATH',
  'DESTINYPATH',
  'PROGRESS',
  'STATE',
] as const;

export const TransferType = {
  Download: 'download',
  Upload: 'upload',
  Sync: 'sync',
  Backup: 'backup',
  Unknown: 'unknown',
} as const;
export type TransferType = (typeof TransferType)[keyof typeof TransferType];

/** The TYPE legend from `mega-exec transfers --help`. */
const typeSymbols: Record<string, TransferType> = {
  '⇓': TransferType.Download,
  '⇑': TransferType.Upload,
  '⇵': TransferType.Sync,
  '⏫': TransferType.Backup,
};

/** STATE as MEGAcmd prints it. Anything else is passed through as is. */
export const TransferState = {
  Queued: 'QUEUED',
  Active: 'ACTIVE',
  Paused: 'PAUSED',
  Retrying: 'RETRYING',
  Completing: 'COMPLETING',
  Completed: 'COMPLETED',
  Cancelled: 'CANCELLED',
  Failed: 'FAILED',
} as const;

const finishedStates: ReadonlySet<string> = new Set([
  TransferState.Completed,
  TransferState.Cancelled,
  TransferState.Failed,
]);

/** Done one way or another: can't be paused, resumed or cancelled anymore. */
export const isFinished = (state: string): boolean => finishedStates.has(state);

export type ParsedTransfer = {
  tag: string;
  type: TransferType;
  sourcePath: string;
  destinationPath: string;
  percent: number;
  /** Null if MEGAcmd printed a size this can't read. */
  totalBytes: number | null;
  state: string;
};

const unitBytes: Record<string, number> = {
  B: 1,
  KB: 1024,
  MB: 1024 ** 2,
  GB: 1024 ** 3,
  TB: 1024 ** 4,
  PB: 1024 ** 5,
};

/** "4.75 GB" ─► bytes. MEGAcmd's units are powers of 1024. */
export function parseSize(text: string): number | null {
  const [, amount, unit] =
    text.trim().match(/^(\d+(?:\.\d+)?)\s*([KMGTP]?B)$/i) ?? [];
  const multiplier = unit && unitBytes[unit.toUpperCase()];
  if (!amount || !multiplier) return null;
  return Math.round(Number(amount) * multiplier);
}

/** "  1.17% of    4.75 GB" ─► { percent: 1.17, totalBytes }. */
export function parseProgress(
  text: string,
): { percent: number; totalBytes: number | null } | null {
  const [, percent, size] =
    text.match(/(\d+(?:\.\d+)?)\s*%(?:\s*of\s*(.+))?/) ?? [];
  if (!percent) return null;
  return {
    percent: Math.min(100, Number(percent)),
    totalBytes: size ? parseSize(size) : null,
  };
}

/**
 * Reads `mega-exec transfers` run with COLUMN_SEPARATOR and TRANSFER_COLUMNS. The header row and
 * any line that isn't a transfer (MEGAcmd's own notices) are skipped.
 */
export function parseTransfers(stdout: string): ParsedTransfer[] {
  return stdout.split(/\r?\n/).flatMap((line): ParsedTransfer[] => {
    const cells = line.split(COLUMN_SEPARATOR).map((cell) => cell.trim());
    if (cells.length !== TRANSFER_COLUMNS.length) return [];

    const [
      type = '',
      tag = '',
      sourcePath = '',
      destinationPath = '',
      progressText = '',
      state = '',
    ] = cells;
    if (!/^\d+$/.test(tag)) return [];
    const progress = parseProgress(progressText);
    if (!progress) return [];

    return [
      {
        tag,
        type: typeSymbols[type] ?? TransferType.Unknown,
        sourcePath,
        destinationPath,
        percent: progress.percent,
        totalBytes: progress.totalBytes,
        state: state.toUpperCase(),
      },
    ];
  });
}

/**
 * `transfers -p -a` pauses the whole queue rather than each transfer, so their STATE stays ACTIVE or
 * QUEUED. The only sign of it is a "DOWNLOADS AND UPLOADS ARE PAUSED" line above the list, which
 * MEGAcmd prints only when there's at least one transfer to list.
 */
export function parsePausedQueues(stdout: string): {
  downloads: boolean;
  uploads: boolean;
} {
  const line =
    stdout.match(
      /^\s*((?:DOWNLOADS|UPLOADS)(?: AND UPLOADS)?) ARE PAUSED\s*$/m,
    )?.[1] ?? '';
  return {
    downloads: line.includes('DOWNLOADS'),
    uploads: line.includes('UPLOADS'),
  };
}

/** `mega-exec whoami` prints "Account e-mail: someone@example.com". */
export function parseWhoAmI(stdout: string): string | null {
  return stdout.match(/e-?mail:\s*(\S+@\S+)/i)?.[1] ?? null;
}

/**
 * MEGAcmd's stderr, made fit to show: its "[Initiating MEGAcmd server…]" notices dropped, and
 * "[2026-10-24_02-20-23.862516 cmd ERR  Not logged in.]" unwrapped to "Not logged in.".
 */
export function cleanErrorOutput(stderr: string): string {
  return stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^\[Initiating MEGAcmd server/i.test(line))
    .map((line) => line.replace(/^\[\S+ cmd (?:ERR|WARN)\s+(.*)\]$/, '$1'))
    .join('\n');
}

const megaHosts = new Set(['mega.nz', 'mega.co.nz', 'mega.io']);

/** An https link on one of MEGA's domains. */
export function isMegaLink(text: string): boolean {
  try {
    const url = new URL(text);
    return (
      url.protocol === 'https:' &&
      megaHosts.has(url.hostname.replace(/^www\./, ''))
    );
  } catch {
    return false;
  }
}
