export const environments = ['development', 'production', 'staging'] as const;
export type EnvironmentName = (typeof environments)[number];

export const isValidEnvironment = (env: string): env is EnvironmentName =>
  environments.includes(env as EnvironmentName);
