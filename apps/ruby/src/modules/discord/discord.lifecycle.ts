import { Injectable, Logger } from '@nestjs/common';
import { Context, type ContextOf, On, Once } from 'necord';

@Injectable()
export class DiscordLifecycle {
  private readonly logger = new Logger(DiscordLifecycle.name);

  @Once('clientReady')
  onReady(@Context() [client]: ContextOf<'clientReady'>) {
    this.logger.log(`Logged in as ${client.user.tag}`);
  }

  @On('warn')
  onWarn(@Context() [message]: ContextOf<'warn'>) {
    this.logger.warn(message);
  }

  @On('error')
  onError(@Context() [error]: ContextOf<'error'>) {
    this.logger.error(error);
  }
}
