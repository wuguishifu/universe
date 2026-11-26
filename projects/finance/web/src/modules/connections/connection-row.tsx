'use client';

import type { FunctionReturnType } from 'convex/server';
import { useState } from 'react';

import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Spinner,
} from '@libs/ui-web';
import type { api } from '@platform/convex-contracts';

import { removeItem } from './actions';

type Item = FunctionReturnType<typeof api.finance.items.list>[number];

const KIND_LABELS: Record<Item['kind'], string> = {
  bank: 'Bank & credit',
  investments: 'Investments',
};

const STATUS_LABELS: Record<Exclude<Item['status'], 'ok'>, string> = {
  login_required: 'Needs reconnecting',
  pending_expiration: 'Access expiring soon',
  error: 'Error',
};

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

export function ConnectionRow({ item }: { item: Item }) {
  const name =
    item.institutionName ?? item.institutionId ?? 'Unknown institution';

  return (
    <li className="flex items-center gap-4 p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {KIND_LABELS[item.kind]} · linked {dateFormat.format(item.linkedAt)}
          {item.status !== 'ok' && (
            <span className="text-destructive">
              {' '}
              · {STATUS_LABELS[item.status]}
              {item.errorCode && ` (${item.errorCode})`}
            </span>
          )}
        </p>
      </div>
      <DisconnectButton itemId={item.itemId} name={name} />
    </li>
  );
}

function DisconnectButton({ itemId, name }: { itemId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disconnect = async () => {
    setPending(true);
    setError(null);
    const result = await removeItem(itemId);
    setPending(false);
    // On success the row disappears on its own (the convex query updates).
    if (result.ok) setOpen(false);
    else setError(result.message);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          Disconnect
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Disconnect {name}?</DialogTitle>
          <DialogDescription>
            This removes the login at Plaid, which stops billing for it. To get
            it back you&apos;ll have to link it again.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={pending}>
              Cancel
            </Button>
          </DialogClose>
          <Button variant="destructive" disabled={pending} onClick={disconnect}>
            {pending && <Spinner />}
            Disconnect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
