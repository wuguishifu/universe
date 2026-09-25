import { S3Props } from '../../s3/s3';

type S3Params = {
  s3Endpoint?: string;
  s3Region?: string;
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
  s3ForcePathStyle?: boolean;
};

type WithS3Config<T extends S3Params> = Omit<T, keyof S3Params> & {
  s3: S3Props | null;
};

export function s3EnvAdapter<T extends S3Params>(data: T): WithS3Config<T> {
  const {
    s3Endpoint,
    s3Region,
    s3AccessKeyId,
    s3SecretAccessKey,
    s3ForcePathStyle,
    ...rest
  } = data;

  return {
    ...rest,
    s3:
      s3Endpoint && s3AccessKeyId && s3SecretAccessKey
        ? {
            endpoint: s3Endpoint,
            region: s3Region,
            accessKeyId: s3AccessKeyId,
            secretAccessKey: s3SecretAccessKey,
            forcePathStyle: s3ForcePathStyle,
          }
        : null,
  };
}
