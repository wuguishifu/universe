import { Injectable } from '@nestjs/common';

import { EnvironmentService } from '../../config/environment';

import { decryptToken, encryptToken, tokenAad } from './token-cipher';

/**
 * Encrypts Plaid access tokens with PLAID_TOKEN_KEY (AES-256-GCM) before they go to convex. The key
 * never leaves this service, so convex and the web app only ever see ciphertext.
 */
@Injectable()
export class TokenCipherService {
  private readonly key: Buffer;

  constructor(environmentService: EnvironmentService) {
    this.key = environmentService.environment.plaidTokenKey;
  }

  encrypt(accessToken: string, userId: string, itemId: string): string {
    return encryptToken(this.key, accessToken, tokenAad(userId, itemId));
  }

  decrypt(ciphertext: string, userId: string, itemId: string): string {
    return decryptToken(this.key, ciphertext, tokenAad(userId, itemId));
  }
}
