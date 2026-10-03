export type TrackingConfig = {
  serviceName: string;
  enableBatching?: boolean;
  debugPrefix?: string;
  analyticsServiceBaseUrl: string;
  analyticsServiceApiKey: string;
};
