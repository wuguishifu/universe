export type NotificationsClientConfig =
  | {
      /** Adds jobs straight to notifications-service's queue. Needs the app's `BullRootModule`. */
      transport: 'queue';
      serviceName: string;
    }
  | {
      /** POSTs to notifications-service, for apps that can't reach its Redis. */
      transport: 'http';
      serviceName: string;
      /** NOTIFICATIONS_SERVICE_URL */
      baseUrl: string;
      /** NOTIFICATIONS_SERVICE_API_TOKEN */
      apiToken: string;
    };

export type NotificationsTransportType = NotificationsClientConfig['transport'];

/** A transport's settings, without the `transport` itself. */
export type NotificationsTransportConfig<T extends NotificationsTransportType> =
  Omit<Extract<NotificationsClientConfig, { transport: T }>, 'transport'>;
