import { Anthropic } from '@anthropic-ai/sdk';
import { Stream } from '@anthropic-ai/sdk/core/streaming';
import { Injectable } from '@nestjs/common';

import { EnvironmentService } from '../../environment/environment-service';

type WithRequestId<T> = T & { _requestId?: string | null | undefined };
type MessageProps = Pick<
  Anthropic.MessageCreateParams,
  'model' | 'messages' | 'system'
>;

@Injectable()
export class ClaudeService {
  private readonly maxTokens = 2 ** 14;
  private readonly client: Anthropic = new Anthropic({
    apiKey: this.environmentService.environment.claudeApiToken,
  });

  constructor(private readonly environmentService: EnvironmentService) {}

  public async createMessage(
    params: MessageProps,
  ): Promise<
    { ok: true; response: Anthropic.Message } | { ok: false; reason: string }
  > {
    try {
      const inputCheck = await this.checkInput(params);
      if (!inputCheck.ok) return inputCheck;

      const message = await this.client.messages.create({
        ...params,
        max_tokens: this.maxTokens,
        stream: false,
      });

      return { ok: true, response: message };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ok: false, reason };
    }
  }

  public async createMessageStream(params: MessageProps): Promise<
    | {
        ok: true;
        response: Stream<
          WithRequestId<Anthropic.Messages.RawMessageStreamEvent>
        >;
      }
    | { ok: false; reason: string }
  > {
    try {
      const inputCheck = await this.checkInput(params);
      if (!inputCheck.ok) return inputCheck;

      const stream = await this.client.messages.create({
        ...params,
        max_tokens: this.maxTokens,
        stream: true,
      });

      return { ok: true, response: stream };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ok: false, reason };
    }
  }

  private async checkInput(
    params: MessageProps,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const tokenCountResponse = await this.client.messages.countTokens(params);
    if (tokenCountResponse.input_tokens > this.maxTokens) {
      return {
        ok: false,
        reason: `Input exceeds maximum token limit of ${this.maxTokens}. Total tokens: ${tokenCountResponse.input_tokens}`,
      };
    }

    return { ok: true };
  }
}
