import { Controller, type MessageEvent, Sse } from '@nestjs/common';
import { tsRestHandler, TsRestHandler } from '@ts-rest/nest';
import { interval, map, merge, type Observable } from 'rxjs';
import {
  StreamEvent,
  thermoRootRouter,
} from '@projects/thermo-automation-contracts';
import { LiveService } from './live.service';

/** Proxies tend to drop connections idle for a minute; snapshots only come every few minutes. */
const PING_INTERVAL_MS = 25_000;

@Controller()
export class LiveController {
  constructor(private readonly liveService: LiveService) {}

  @TsRestHandler({
    snapshot: thermoRootRouter.snapshot,
    status: thermoRootRouter.status,
  })
  public handler() {
    return tsRestHandler(
      { snapshot: thermoRootRouter.snapshot, status: thermoRootRouter.status },
      {
        snapshot: async () => ({
          status: 200,
          body: await this.liveService.build(),
        }),
        status: () =>
          Promise.resolve({
            status: 200,
            body: this.liveService.getStatus(),
          }),
      },
    );
  }

  /**
   * Server-Sent Events: a response that stays open, with the server writing an event into it
   * whenever there's something new. The browser's EventSource reads them and reconnects by itself
   * if the connection drops. Nest frames each emitted value as an event, serializing `data` to JSON.
   *
   * A connecting client gets the latest snapshot straight away (LiveService.snapshot$ replays it).
   */
  @Sse('api/stream')
  public stream(): Observable<MessageEvent> {
    return merge(
      this.liveService.snapshot$.pipe(
        map((snapshot) => ({ type: StreamEvent.Snapshot, data: snapshot })),
      ),
      interval(PING_INTERVAL_MS).pipe(
        map(() => ({ type: StreamEvent.Ping, data: '' })),
      ),
    );
  }
}
