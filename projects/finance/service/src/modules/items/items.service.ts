import { Injectable, Logger } from '@nestjs/common';

import { api, type Id } from '@platform/convex-contracts';
import type { LinkedItem, LinkKind } from '@projects/finance-contracts';

import { ConvexService } from '../common/convex.service';
import { TokenCipherService } from '../crypto/token-cipher.service';
import { LINK_PRODUCTS } from '../plaid/link-products';
import {
  formatPlaidError,
  PlaidService,
  plaidErrorCode,
} from '../plaid/plaid.service';

/** Plaid error codes from item.remove that mean the item is already gone at Plaid. */
const ALREADY_REMOVED = new Set(['ITEM_NOT_FOUND', 'INVALID_ACCESS_TOKEN']);

/** Linking and unlinking Plaid items. See projects/finance/LINK.md. */
@Injectable()
export class ItemsService {
  private readonly logger = new Logger(ItemsService.name);

  constructor(
    private readonly plaidService: PlaidService,
    private readonly convexService: ConvexService,
    private readonly tokenCipher: TokenCipherService,
  ) {}

  private get plaid() {
    return this.plaidService.client;
  }

  async createLinkToken(
    userId: Id<'users'>,
    kind: LinkKind,
  ): Promise<{ linkToken: string; expiration: string }> {
    const { link_token, expiration } = await this.plaid.link.createToken({
      client_name: 'Finance',
      language: 'en',
      country_codes: ['US'],
      user: { client_user_id: userId },
      ...LINK_PRODUCTS[kind],
      // pull as much history as Plaid allows on the first sync
      ...(kind === 'bank' && { transactions: { days_requested: 730 } }),
    });
    return { linkToken: link_token, expiration };
  }

  async exchangePublicToken(
    userId: Id<'users'>,
    publicToken: string,
    kind: LinkKind,
  ): Promise<LinkedItem> {
    const { access_token, item_id } = await this.plaid.item.exchangePublicToken(
      { public_token: publicToken },
    );

    try {
      const { item } = await this.plaid.item.get({ access_token });
      const saved = await this.convexService.mutation(
        api.finance.items.upsertLinked,
        {
          userId,
          itemId: item_id,
          kind,
          institutionId: item.institution_id ?? null,
          institutionName: item.institution_name ?? null,
          products: item.products,
          encryptedAccessToken: this.tokenCipher.encrypt(
            access_token,
            userId,
            item_id,
          ),
          consentExpirationTime: item.consent_expiration_time
            ? Date.parse(item.consent_expiration_time)
            : undefined,
        },
      );
      this.logger.log(
        `Linked ${saved.institutionName ?? saved.institutionId} (${kind}, item ${item_id}), products: ${item.products.join(', ')}`,
      );
      return {
        itemId: saved.itemId,
        kind: saved.kind,
        institutionName: saved.institutionName,
      };
    } catch (error) {
      // Nothing saved the token, so nothing could ever remove this item. Remove it now so Plaid
      // doesn't bill for it.
      await this.plaid.item.remove({ access_token }).catch((removeError) => {
        this.logger.error(
          `Couldn't remove unsaved item ${item_id}: ${formatPlaidError(removeError)}`,
        );
      });
      throw error;
    }
  }

  /** Removes the item at Plaid, which stops billing for it, then deletes it from convex. */
  async removeItem(userId: Id<'users'>, itemId: string): Promise<void> {
    const { encryptedAccessToken } = await this.convexService.query(
      api.finance.items.getEncryptedAccessToken,
      { userId, itemId },
    );
    const accessToken = this.tokenCipher.decrypt(
      encryptedAccessToken,
      userId,
      itemId,
    );

    try {
      await this.plaid.item.remove({ access_token: accessToken });
    } catch (error) {
      const code = plaidErrorCode(error);
      if (!code || !ALREADY_REMOVED.has(code)) throw error;
      this.logger.warn(`Item ${itemId} was already gone at Plaid (${code})`);
    }

    await this.convexService.mutation(api.finance.items.remove, {
      userId,
      itemId,
    });
    this.logger.log(`Removed item ${itemId}`);
  }
}
