import type { FunctionReturnType } from 'convex/server';

import type { api } from '@platform/convex-contracts';

export type Party = NonNullable<
  FunctionReturnType<typeof api.game.parties.get>
>;
export type PartyEvent = Party['events'][number];
export type PartyPlayer = Party['players'][number];
export type Standing = Party['standings'][number];
