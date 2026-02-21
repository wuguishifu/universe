import { JsonRpcProvider } from '@ethersproject/providers';
import { Wallet } from '@ethersproject/wallet';
import { Module } from '@nestjs/common';
import { RelayClient, RelayerTxType } from '@polymarket/builder-relayer-client';
import { BuilderConfig } from '@polymarket/builder-signing-sdk';

import { POLYGON_CHAIN_ID, RELAYER_API_BASE } from '@wuguishifu/utils-polymarket';

import { RelayerService } from './relayer.service';
import { POLYMARKET_RELAY_CLIENT } from '../../constants';
import { EnvironmentService } from '../../environment/environment-service';

@Module({
  providers: [
    {
      provide: POLYMARKET_RELAY_CLIENT,
      useFactory: (environmentService: EnvironmentService) => {
        const { privateKey, polyApiKey, polyApiSecret, polyApiPassphrase, polygonRpcUrl } =
          environmentService.environment;
        const formattedKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;

        const provider = new JsonRpcProvider(polygonRpcUrl);
        const signer = new Wallet(formattedKey, provider);

        const builderConfig = new BuilderConfig({
          localBuilderCreds: {
            key: polyApiKey,
            secret: polyApiSecret,
            passphrase: polyApiPassphrase,
          },
        });

        return new RelayClient(RELAYER_API_BASE, POLYGON_CHAIN_ID, signer, builderConfig, RelayerTxType.PROXY);
      },
      inject: [EnvironmentService],
    },
    RelayerService,
  ],
  exports: [RelayerService],
})
export class RelayerModule {}
