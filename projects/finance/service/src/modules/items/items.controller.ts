import { Controller, Logger, UseGuards } from '@nestjs/common';
import { tsRestHandler, TsRestHandler } from '@ts-rest/nest';

import type { Id } from '@platform/convex-contracts';
import { financeRootRouter } from '@projects/finance-contracts';

import { ConvexJwtGuard, UserId } from '../../auth/convex-jwt.guard';
import { formatPlaidError } from '../plaid/plaid.service';
import { SyncService } from '../sync/sync.service';

import { toItemsError } from './items.errors';
import { ItemsService } from './items.service';

@UseGuards(ConvexJwtGuard)
@Controller()
export class ItemsController {
  private readonly logger = new Logger(ItemsController.name);

  constructor(
    private readonly itemsService: ItemsService,
    private readonly syncService: SyncService,
  ) {}

  @TsRestHandler(financeRootRouter)
  public handler(@UserId() userId: Id<'users'>) {
    return tsRestHandler(financeRootRouter, {
      createLinkToken: ({ body }) =>
        this.respond('createLinkToken', async () => ({
          status: 200,
          body: await this.itemsService.createLinkToken(userId, body.kind),
        })),
      exchangePublicToken: ({ body }) =>
        this.respond('exchangePublicToken', async () => ({
          status: 201,
          body: await this.itemsService.exchangePublicToken(
            userId,
            body.publicToken,
            body.kind,
          ),
        })),
      removeItem: ({ params: { itemId } }) =>
        this.respond('removeItem', async () => {
          await this.itemsService.removeItem(userId, itemId);
          return { status: 200, body: { itemId } };
        }),
      syncItems: () =>
        this.respond('syncItems', async () => ({
          status: 200,
          body: { items: await this.syncService.syncUser(userId) },
        })),
    });
  }

  /** Runs `handler`, turning expected convex and Plaid errors into responses. */
  private async respond<T>(route: string, handler: () => Promise<T>) {
    try {
      return await handler();
    } catch (error) {
      // Never the error itself: a Plaid error carries the request's headers, secret included.
      this.logger.error(`${route} failed: ${formatPlaidError(error)}`);
      return toItemsError(error).toResponse();
    }
  }
}
