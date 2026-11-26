'use client';

import { RefreshCwIcon } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@libs/ui-web';

import { syncAccounts } from '../connections/actions';

/**
 * Asks finance-service to sync now. The new balances arrive through the convex query; this only
 * reports failures that convex doesn't record (Plaid ones show on the item).
 */
export function RefreshButton({
  onError,
}: {
  onError: (message: string | null) => void;
}) {
  const [pending, setPending] = useState(false);

  const refresh = async () => {
    setPending(true);
    onError(null);
    const result = await syncAccounts();
    setPending(false);
    if (!result.ok) {
      onError(result.message);
      return;
    }
    const failed = result.items.filter(
      (item) => !item.ok && item.errorCode === 'SYNC_FAILED',
    );
    if (failed.length) {
      onError(
        `Couldn't refresh ${failed
          .map((item) => item.institutionName ?? item.itemId)
          .join(', ')}.`,
      );
    }
  };

  return (
    <Button variant="outline" size="sm" disabled={pending} onClick={refresh}>
      <RefreshCwIcon className={pending ? 'animate-spin' : undefined} />
      Refresh
    </Button>
  );
}
