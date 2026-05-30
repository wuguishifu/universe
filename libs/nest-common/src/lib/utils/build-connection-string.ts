export type DbConfig = {
  user?: string;
  password?: string;
  host?: string;
  port?: number;
  database: string;
  ssl?: {
    rejectUnauthorized?: boolean;
  };
};

export const buildConnectionString = (
  dbConfig: DbConfig,
  options?: { excludeDb: boolean },
) =>
  `postgres://${dbConfig.user}:${dbConfig.password}@${dbConfig.host}:${dbConfig.port}${
    options?.excludeDb ? '' : `/${dbConfig.database}`
  }`;
