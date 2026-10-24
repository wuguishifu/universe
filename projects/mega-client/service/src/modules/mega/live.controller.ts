import { Controller, type MessageEvent, Sse } from '@nestjs/common';
import { tsRestHandler, TsRestHandler } from '@ts-rest/nest';
import { interval, map, merge, type Observable } from 'rxjs';

import { megaRootRouter, StreamEvent } from '@projects/mega-client-contracts';

import { LiveService } from './live.service';

/** Proxies tend to drop connections idle for a minute; nothing changes while nothing transfers. */
const PING_INTERVAL_MS = 25_000;

@Controller()
export class LiveController {
  constructor(private readonly liveService: LiveService) {}

  @TsRestHandler(megaRootRouter.snapshot)
  public handler() {
    return tsRestHandler(megaRootRouter.snapshot, async () => ({
      status: 200,
      body: await this.liveService.build(),
    }));
  }

  /**
   * Server-Sent Events: a response that stays open, with the server writing an event into it
   * whenever there's something new. The browser's EventSource reads them and reconnects by itself
   * if the connection drops. Nest frames each emitted value as an event, serializing `data` to JSON.
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
