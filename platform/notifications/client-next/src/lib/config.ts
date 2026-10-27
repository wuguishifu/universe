export type NotificationsClientConfig = {
  serviceName: string;
  /** NOTIFICATIONS_SERVICE_URL */
  baseUrl: string;
  /** NOTIFICATIONS_SERVICE_API_TOKEN */
  apiToken: string;
  /** Sent with every request, e.g. a Cloudflare Access service token for a tunnel in front of the service. */
  headers?: Record<string, string>;
};
