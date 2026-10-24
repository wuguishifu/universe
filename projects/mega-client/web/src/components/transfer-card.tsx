import {
  ArrowDownToLine,
  ArrowUpToLine,
  CircleHelp,
  DatabaseBackup,
  Pause,
  Play,
  RefreshCcw,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { Button, cn } from '@libs/ui-web';
import {
  isFinished,
  type Transfer,
  TransferState,
  TransferType,
} from '@projects/mega-client-contracts';
import { api, expect } from '../lib/api';
import { formatBytes, formatEta, formatSpeed } from '../lib/format';
import { useApiMutation } from '../lib/use-api-mutation';

const typeIcons = {
  [TransferType.Download]: ArrowDownToLine,
  [TransferType.Upload]: ArrowUpToLine,
  [TransferType.Sync]: RefreshCcw,
  [TransferType.Backup]: DatabaseBackup,
  [TransferType.Unknown]: CircleHelp,
} as const;

const states: Record<string, { label: string; className: string }> = {
  [TransferState.Queued]: {
    label: 'Queued',
    className: 'text-muted-foreground',
  },
  [TransferState.Active]: { label: 'Active', className: 'text-primary' },
  [TransferState.Paused]: { label: 'Paused', className: 'text-warning' },
  [TransferState.Retrying]: { label: 'Retrying', className: 'text-warning' },
  [TransferState.Completing]: { label: 'Finishing', className: 'text-primary' },
  [TransferState.Completed]: { label: 'Done', className: 'text-good' },
  [TransferState.Cancelled]: {
    label: 'Cancelled',
    className: 'text-muted-foreground',
  },
  [TransferState.Failed]: { label: 'Failed', className: 'text-critical' },
};

const pausable: ReadonlySet<string> = new Set([
  TransferState.Queued,
  TransferState.Active,
  TransferState.Retrying,
]);

export function TransferCard({ transfer }: { transfer: Transfer }) {
  const { tag, state, percent, totalBytes, bytesPerSecond, etaSeconds } =
    transfer;
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const pause = useApiMutation(() =>
    expect(api.transfers.pause({ params: { tag } }), 200),
  );
  const resume = useApiMutation(() =>
    expect(api.transfers.resume({ params: { tag } }), 200),
  );
  const cancel = useApiMutation(
    () => expect(api.transfers.cancel({ params: { tag } }), 200),
    { onSuccess: () => setConfirmingCancel(false) },
  );
  const busy = pause.isPending || resume.isPending || cancel.isPending;

  const finished = isFinished(state);
  const Icon = typeIcons[transfer.type];
  const { heldByQueue } = transfer;
  // MEGAcmd still says ACTIVE or QUEUED for these: "pause all" holds the queue, not each transfer.
  const { label, className } = heldByQueue
    ? { label: 'Paused with all', className: 'text-warning' }
    : (states[state] ?? { label: state, className: 'text-muted-foreground' });

  const details = [
    `${percent.toFixed(percent < 10 ? 2 : 1)}%`,
    totalBytes !== null &&
      (finished
        ? formatBytes(totalBytes)
        : `${formatBytes((percent / 100) * totalBytes)} of ${formatBytes(totalBytes)}`),
    bytesPerSecond !== null && formatSpeed(bytesPerSecond),
    etaSeconds !== null && `${formatEta(etaSeconds)} left`,
  ].filter(Boolean);

  return (
    <li
      className={cn(
        'flex flex-col gap-3 rounded-lg border bg-card p-4 text-card-foreground',
        finished && 'opacity-60',
      )}
    >
      <div className="flex items-start gap-3">
        <Icon
          className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
          aria-label={transfer.type}
        />
        <div className="min-w-0 flex-1">
          <p
            className="break-words text-sm font-medium"
            title={transfer.destinationPath}
          >
            {transfer.name}
          </p>
          <p className={cn('mt-0.5 text-xs font-medium', className)}>{label}</p>
        </div>
        {!finished && !confirmingCancel && (
          <div className="-my-1 -mr-1 flex shrink-0 gap-1">
            {/* Held ones only move again with "resume all", so there's nothing to toggle here. */}
            {heldByQueue ? null : state === TransferState.Paused ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Resume"
                disabled={busy}
                onClick={() => resume.mutate(undefined)}
              >
                <Play className="h-4 w-4" />
              </Button>
            ) : (
              pausable.has(state) && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Pause"
                  disabled={busy}
                  onClick={() => pause.mutate(undefined)}
                >
                  <Pause className="h-4 w-4" />
                </Button>
              )
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Cancel"
              disabled={busy}
              onClick={() => setConfirmingCancel(true)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {!finished && (
        <div
          className="h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-500',
              state === TransferState.Active && !heldByQueue
                ? 'bg-primary'
                : 'bg-muted-foreground/50',
            )}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}

      <p className="text-xs tabular-nums text-muted-foreground">
        {details.join(' · ')}
      </p>

      {confirmingCancel && (
        <div className="flex items-center justify-between gap-3 rounded-md bg-destructive/10 p-2 pl-3 text-sm">
          <span>Cancel this transfer?</span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={cancel.isPending}
              onClick={() => setConfirmingCancel(false)}
            >
              Keep
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate(undefined)}
            >
              Cancel it
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
