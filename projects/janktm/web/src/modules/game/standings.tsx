import { cn } from '@libs/ui-web';

import { ordinal } from './format';
import type { PartyPlayer, Standing } from './types';

const MEDAL_STYLES: Record<number, string> = {
  1: 'bg-gold text-foreground',
  2: 'bg-silver text-foreground',
  3: 'bg-bronze text-primary-foreground',
};

export function Standings({
  standings,
  meId,
}: {
  standings: Standing[];
  meId: PartyPlayer['_id'] | undefined;
}) {
  if (standings.length === 0) {
    return (
      <p className="py-8 text-center text-muted-foreground">
        Nobody has joined yet.
      </p>
    );
  }

  return (
    <ol className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
      {standings.map((standing) => (
        <li
          key={standing.playerId}
          className={cn(
            'flex items-center gap-3 px-4 py-3',
            standing.playerId === meId && 'bg-primary/10',
          )}
        >
          <span
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold',
              MEDAL_STYLES[standing.rank] ?? 'bg-muted text-muted-foreground',
            )}
          >
            {ordinal(standing.rank)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">
              {standing.name}
              {standing.playerId === meId && (
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  (you)
                </span>
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              {standing.eventsPlayed}{' '}
              {standing.eventsPlayed === 1 ? 'event' : 'events'}
            </p>
          </div>
          <span className="font-display text-xl font-semibold tabular-nums">
            {standing.total}
          </span>
        </li>
      ))}
    </ol>
  );
}
