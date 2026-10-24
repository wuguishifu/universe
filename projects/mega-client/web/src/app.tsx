import {
  CircleUser,
  CircleX,
  CloudDownload,
  Pause,
  Play,
  TriangleAlert,
  WifiOff,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Toaster } from 'sonner';
import { Button, cn, Spinner } from '@libs/ui-web';
import { isFinished, TransferState } from '@projects/mega-client-contracts';
import { AccountDrawer } from './components/account-drawer';
import { QueueForm } from './components/queue-form';
import { TransferCard } from './components/transfer-card';
import { api, expect } from './lib/api';
import { useApiMutation } from './lib/use-api-mutation';
import { useLiveSnapshot } from './lib/use-live-snapshot';

const movingStates: ReadonlySet<string> = new Set([
  TransferState.Queued,
  TransferState.Active,
  TransferState.Retrying,
]);

export function App() {
  const { snapshot, connection, error } = useLiveSnapshot();
  const [accountOpen, setAccountOpen] = useState(false);

  const pauseAll = useApiMutation(() => expect(api.transfers.pauseAll(), 200));
  const resumeAll = useApiMutation(() =>
    expect(api.transfers.resumeAll(), 200),
  );
  const [confirmingCancelAll, setConfirmingCancelAll] = useState(false);
  const cancelAll = useApiMutation(
    () => expect(api.transfers.cancelAll(), 200),
    { onSuccess: () => setConfirmingCancelAll(false) },
  );

  if (!snapshot) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-4 text-sm text-muted-foreground">
        {error ? (
          <p className="flex items-center gap-2 text-critical">
            <TriangleAlert className="h-4 w-4" aria-hidden />
            Couldn't reach the service: {error.message}
          </p>
        ) : (
          <Spinner />
        )}
      </main>
    );
  }

  const { account, transfers, queuePaused } = snapshot;
  const unfinished = transfers.filter(({ state }) => !isFinished(state));
  const anyMoving = unfinished.some(
    ({ state, heldByQueue }) => movingStates.has(state) && !heldByQueue,
  );
  const anyPaused = unfinished.some(
    ({ state }) => state === TransferState.Paused,
  );
  // Resume wins while the queue is paused, even if something's still moving: it's the one that
  // undoes "pause all". Resume all also resumes the ones paused on their own.
  const bulkAction = queuePaused
    ? 'resume'
    : anyMoving
      ? 'pause'
      : anyPaused
        ? 'resume'
        : null;
  const bulkPending =
    pauseAll.isPending || resumeAll.isPending || cancelAll.isPending;

  return (
    <main className="mx-auto grid max-w-2xl grid-cols-1 gap-4 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] sm:gap-6 sm:py-8">
      <header className="flex items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <CloudDownload className="h-5 w-5 text-primary" aria-hidden />
          Mega Client
        </h1>
        <div className="flex min-w-0 items-center gap-1">
          {bulkAction === 'pause' && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Pause all"
              disabled={bulkPending}
              onClick={() => pauseAll.mutate(undefined)}
            >
              <Pause className="h-5 w-5" />
            </Button>
          )}
          {bulkAction === 'resume' && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Resume all"
              disabled={bulkPending}
              onClick={() => resumeAll.mutate(undefined)}
            >
              <Play className="h-5 w-5" />
            </Button>
          )}
          {unfinished.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Cancel all"
              disabled={bulkPending || confirmingCancelAll}
              onClick={() => setConfirmingCancelAll(true)}
            >
              <CircleX className="h-5 w-5" />
            </Button>
          )}
          <Button
            variant="ghost"
            className="min-w-0 gap-2 px-2"
            onClick={() => setAccountOpen(true)}
            aria-label="MEGA account"
          >
            <CircleUser
              className={cn(
                'h-5 w-5 shrink-0',
                account.loggedIn ? 'text-good' : 'text-muted-foreground',
              )}
            />
            <span className="hidden max-w-48 truncate text-sm sm:inline">
              {account.loggedIn ? account.email : 'Not logged in'}
            </span>
          </Button>
        </div>
      </header>

      {confirmingCancelAll && unfinished.length > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-destructive/10 p-2 pl-4 text-sm">
          <span>
            Cancel{' '}
            {unfinished.length === 1 ? 'the' : `all ${unfinished.length}`}{' '}
            unfinished transfer{unfinished.length === 1 ? '' : 's'}?
          </span>
          <div className="flex shrink-0 gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={cancelAll.isPending}
              onClick={() => setConfirmingCancelAll(false)}
            >
              Keep
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={cancelAll.isPending}
              onClick={() => cancelAll.mutate(undefined)}
            >
              Cancel all
            </Button>
          </div>
        </div>
      )}

      {connection === 'disconnected' && (
        <Banner icon={<WifiOff className="h-4 w-4" aria-hidden />}>
          Lost the live connection to the service. It'll reconnect by itself.
        </Banner>
      )}

      {snapshot.error && (
        <Banner icon={<TriangleAlert className="h-4 w-4" aria-hidden />}>
          <p className="font-medium">Couldn't read MEGAcmd</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-foreground/80">
            {snapshot.error}
          </p>
        </Banner>
      )}

      {!account.loggedIn && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
          <span>Not logged in: MEGA's free download quota applies.</span>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={() => setAccountOpen(true)}
          >
            Log in
          </Button>
        </div>
      )}

      <QueueForm />

      {transfers.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No transfers yet. Paste a MEGA link above to download it.
        </p>
      ) : (
        <ul className="grid gap-3">
          {transfers.map((transfer) => (
            <TransferCard key={transfer.tag} transfer={transfer} />
          ))}
        </ul>
      )}

      <AccountDrawer
        open={accountOpen}
        onOpenChange={setAccountOpen}
        account={account}
      />
      <Toaster theme="system" richColors position="top-center" />
    </main>
  );
}

function Banner({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div
      className="flex gap-3 rounded-lg border border-critical/30 bg-critical/10 p-4 text-sm text-critical"
      role="alert"
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 text-foreground">{children}</div>
    </div>
  );
}
