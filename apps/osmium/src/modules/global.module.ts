import { Global, Module } from '@nestjs/common';

import { HYDROGEN_DB, HydrogenDbProvider } from '@wuguishifu/nest-common';

@Global()
@Module({
  providers: [HydrogenDbProvider],
  exports: [HYDROGEN_DB],
})
export class GlobalModule {}
