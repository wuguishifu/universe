import { BullModule } from '@nestjs/bullmq';
import {
  DynamicModule,
  InjectionToken,
  Module,
  ModuleMetadata,
  OptionalFactoryDependency,
  Provider,
} from '@nestjs/common';

import { DEFAULT_QUEUE_CONFIG } from '@libs/queue';
import {
  NOTIFICATIONS_QUEUE_CONFIG,
  NOTIFICATIONS_QUEUE_PREFIX,
} from '@platform/notifications-contracts';

import {
  type NotificationsClientConfig,
  type NotificationsTransportConfig,
  type NotificationsTransportType,
} from './config';
import {
  NOTIFICATION_TRANSPORT,
  NOTIFICATIONS_CLIENT_CONFIG,
} from './constants';
import { NotificationsClient } from './notifications-client.service';
import { HttpTransport } from './transports/http.transport';
import { QueueTransport } from './transports/queue.transport';

/**
 * The transport is given up front, not by `useFactory`: the queue transport has to import the
 * queue when the module is built.
 */
export type NotificationsClientModuleAsyncOptions<
  T extends NotificationsTransportType,
> = Pick<ModuleMetadata, 'imports'> & {
  transport: T;
  inject?: (InjectionToken | OptionalFactoryDependency)[];
  useFactory: (
    ...args: never[]
  ) =>
    NotificationsTransportConfig<T> | Promise<NotificationsTransportConfig<T>>;
};

/**
 * Provides `NotificationsClient` app-wide. With the `queue` transport it needs the app's
 * `BullRootModule` (on the same Redis as notifications-service), whose connection it reuses with
 * notifications-service's prefix.
 */
@Module({})
export class NotificationsClientModule {
  public static forRoot(config: NotificationsClientConfig): DynamicModule {
    return NotificationsClientModule.create(config.transport, [], {
      provide: NOTIFICATIONS_CLIENT_CONFIG,
      useValue: config,
    });
  }

  public static forRootAsync<T extends NotificationsTransportType>({
    transport,
    imports = [],
    inject = [],
    useFactory,
  }: NotificationsClientModuleAsyncOptions<T>): DynamicModule {
    return NotificationsClientModule.create(transport, imports, {
      provide: NOTIFICATIONS_CLIENT_CONFIG,
      inject,
      useFactory,
    });
  }

  private static create(
    transport: NotificationsTransportType,
    imports: NonNullable<ModuleMetadata['imports']>,
    configProvider: Provider,
  ): DynamicModule {
    return {
      module: NotificationsClientModule,
      global: true,
      imports: [
        ...imports,
        ...(transport === 'queue'
          ? [
              BullModule.registerQueue({
                name: NOTIFICATIONS_QUEUE_CONFIG.send.queueName,
                prefix: NOTIFICATIONS_QUEUE_PREFIX,
                defaultJobOptions: DEFAULT_QUEUE_CONFIG,
              }),
            ]
          : []),
      ],
      providers: [
        configProvider,
        {
          provide: NOTIFICATION_TRANSPORT,
          useClass: transport === 'queue' ? QueueTransport : HttpTransport,
        },
        NotificationsClient,
      ],
      exports: [NotificationsClient],
    };
  }
}
