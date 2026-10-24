import { Controller } from '@nestjs/common';
import { tsRestHandler, TsRestHandler } from '@ts-rest/nest';

import { megaRootRouter } from '@projects/mega-client-contracts';

import { AccountService } from './account.service';
import { LiveService } from './live.service';

@Controller()
export class AccountController {
  constructor(
    private readonly accountService: AccountService,
    private readonly liveService: LiveService,
  ) {}

  @TsRestHandler(megaRootRouter.account)
  public handler() {
    return tsRestHandler(megaRootRouter.account, {
      login: ({ body }) =>
        this.liveService.afterChange(() => this.accountService.login(body)),
      logout: () =>
        this.liveService.afterChange(() => this.accountService.logout()),
    });
  }
}
