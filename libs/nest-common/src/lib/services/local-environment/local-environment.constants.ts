export const ENVIRONMENT_SCHEMA = 'environment_schema';
export const ENVIRONMENT_OPTIONS = 'environment_options';

export type EnvironmentOptions = {
  /**
   * Optional prefix for environment variables, e.g. "API_".
   * If set, the service reads process.env.API_FOO into schema key "FOO".
   */
  prefix?: string;
};
