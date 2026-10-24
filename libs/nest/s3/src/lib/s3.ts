export type S3Props = {
  endpoint: string;
  region?: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
};

export const S3_CONFIG = 'S3_CONFIG';
