import type { TickStatus } from '@projects/thermo-automation-contracts';

import type { Connection } from './use-live-snapshot';

export type Health =
  | { tone: 'good'; label: string }
  | { tone: 'warning' | 'critical'; label: string; detail: string | null };

/** A run counts as late once 2.5 intervals have passed without a successful one. */
const LATE_AFTER_INTERVALS = 2.5;

export function getHealth(
  status: TickStatus,
  connection: Connection,
  now: number,
  formatAgo: (since: string) => string,
): Health {
  if (connection === 'disconnected') {
    return {
      tone: 'critical',
      label: 'Disconnected',
      detail:
        "Lost the live connection to the service. It'll reconnect by itself.",
    };
  }
  const lastSuccess = status.lastSuccessAt
    ? `Last successful run ${formatAgo(status.lastSuccessAt)}.`
    : 'No successful run yet.';
  if (status.lastError) {
    return {
      tone: status.consecutiveFailures > 1 ? 'critical' : 'warning',
      label:
        status.consecutiveFailures > 1
          ? `${status.consecutiveFailures} runs failed`
          : 'Last run failed',
      detail: `${lastSuccess}\n${status.lastError}`,
    };
  }
  if (
    status.lastSuccessAt &&
    now - new Date(status.lastSuccessAt).getTime() >
      status.tickIntervalMs * LATE_AFTER_INTERVALS
  ) {
    return {
      tone: 'warning',
      label: `Updated ${formatAgo(status.lastSuccessAt)}`,
      detail: `${lastSuccess} Runs are supposed to happen every ${Math.round(status.tickIntervalMs / 60_000)} minutes.`,
    };
  }
  return {
    tone: 'good',
    label: status.lastSuccessAt
      ? `Updated ${formatAgo(status.lastSuccessAt)}`
      : 'Starting up',
  };
}
