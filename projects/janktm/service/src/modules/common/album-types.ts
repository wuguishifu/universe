import type { FunctionReturnType } from 'convex/server';

import type { api } from '@platform/convex-contracts';

/** An item job as Convex hands it out to queue (album/helpers.ts's `JobInput`). */
export type JobInput = FunctionReturnType<
  typeof api.album.scan.upsertItems
>['toQueue'][number];

/** Mirrors album/validators.ts's `mediaInfo`. */
export type MediaInfo = JobInput['media'];
