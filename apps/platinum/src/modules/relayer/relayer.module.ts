import { JsonRpcProvider } from '@ethersproject/providers';
import { Wallet } from '@ethersproject/wallet';
import { Module } from '@nestjs/common';
import { RelayClient, RelayerTxType } from '@polymarket/builder-relayer-client';
import { BuilderConfig } from '@polymarket/builder-signing-sdk';

import { RelayerService } from './relayer.service';
import { POLYGON_CHAIN_ID, POLYGON_RPC_URL, POLYMARKET_RELAY_CLIENT, RELAYER_API_BASE } from '../../constants';
import { EnvironmentService } from '../../environment/environment-service';

@Module({
  providers: [
    {
      provide: POLYMARKET_RELAY_CLIENT,
      useFactory: (environmentService: EnvironmentService) => {
        const { privateKey, polyApiKey, polyApiSecret, polyApiPassphrase } = environmentService.environment;
        const formattedKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;

        const provider = new JsonRpcProvider(POLYGON_RPC_URL);
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
