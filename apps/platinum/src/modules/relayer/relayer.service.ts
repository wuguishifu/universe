import { Inject, Injectable, Logger } from '@nestjs/common';
import { RelayClient } from '@polymarket/builder-relayer-client';

import { OsmiumService } from '@wuguishifu/nest-common';

import { CONDITIONAL_TOKENS_ADDRESS, POLYMARKET_RELAY_CLIENT } from '../../constants';
import { EnvironmentService } from '../../environment/environment-service';

@Injectable()
export class RelayerService {
  private readonly logger = new Logger(RelayerService.name);

  constructor(
    private readonly osmiumService: OsmiumService,
    private readonly environmentService: EnvironmentService,
    @Inject(POLYMARKET_RELAY_CLIENT) private readonly relayClient: RelayClient,
  ) {}

  public async executeRelayerTx(
    actionName: string,
    data: `0x${string}`[],
    metadata: Record<string, unknown>,
  ): Promise<string> {
    if (!this.relayClient) {
      throw new Error('Relayer client not initialized');
    }

    this.logger.log(`Executing ${actionName} with metadata: ${JSON.stringify(metadata)}`);
    this.osmiumService.trackEvent({
      name: `relayer_service-${actionName}-started`,
      metadata,
    });

    const tx = data.map((d) => ({ to: CONDITIONAL_TOKENS_ADDRESS, data: d, value: '0' }));

    if (this.environmentService.environment.dryRun) {
      this.logger.warn(`Dry run enabled - skipping ${actionName} execution`);
      this.osmiumService.trackEvent({
        name: `relayer_service-${actionName}-skipped`,
        metadata,
      });
      return 'dry-run-tx-id';
    }

    try {
      const response = await this.relayClient.execute(tx);
      const result = await response.wait();

      if (result) {
        this.logger.log(`${actionName} transaction submitted: ${result.transactionHash}`);
        this.osmiumService.trackEvent({
          name: `relayer_service-${actionName}-finished`,
          metadata: { ...metadata, transactionHash: result.transactionHash },
        });
        return result.transactionID;
      }

      // wait() returns undefined when the tx hits STATE_FAILED or polling times out
      const txDetails = await response.getTransaction().catch(() => undefined);
      const failureMetadata = {
        ...metadata,
        relayerTxId: response.transactionID,
        transactionHash: txDetails?.[0]?.transactionHash,
        state: txDetails?.[0]?.state,
      };

      this.logger.error(`${actionName} failed on-chain: ${JSON.stringify(failureMetadata)}`);
      this.osmiumService.trackEvent({
        name: `relayer_service-${actionName}-failed`,
        metadata: failureMetadata,
      });
      throw new Error(`Failed to submit ${actionName} transaction (txId: ${response.transactionID})`);
    } catch (error) {
      // If already handled above (re-thrown), propagate as-is
      if (error instanceof Error && error.message.startsWith(`Failed to submit ${actionName}`)) {
        throw error;
      }

      // Unexpected error from execute() or wait()
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`${actionName} unexpected error: ${errorMessage}`);
      this.osmiumService.trackEvent({
        name: `relayer_service-${actionName}-failed`,
        metadata: { ...metadata, error: errorMessage },
      });
      throw new Error(`${actionName} error: ${errorMessage}`);
    }
  }
}
