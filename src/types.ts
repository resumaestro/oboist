export type DatabaseStatement = {
  all(): Promise<D1Result<unknown>>;
  bind(...values: unknown[]): DatabaseStatement;
};

export type DatabaseClient = Pick<D1Database, 'exec'> & {
  prepare(query: string): DatabaseStatement;
};

export type OboistEnvironment = {
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_TOKEN: string;
  OBOIST_SECRET: string;
  PRODUCTION: DatabaseClient;
  SANDBOX: DatabaseClient;
  STAGING: DatabaseClient;
  RESUMAESTRO_CONFIG: KVNamespace;
  RESUMAESTRO_PIPELINE: KVNamespace;
  SECRETS_STORE_ID: string;
  SLACK_APP_ID: string;
  SLACK_CONFIG_REFRESH_TOKEN: SecretsStoreSecret;
  SLACK_CONFIG_TOKEN: SecretsStoreSecret;
};
export const STORE_NAMES = [
  'RESUMAESTRO_CONFIG',
  'RESUMAESTRO_PIPELINE',
  'PRODUCTION',
  'SANDBOX',
  'STAGING'
] as const
export const STORES: Set<keyof OboistEnvironment> = new Set(STORE_NAMES);

export type Store = typeof STORE_NAMES[number]

export type DatabaseEnvironment = Pick<
  OboistEnvironment,
  'PRODUCTION' | 'SANDBOX' | 'STAGING'
>;

export type ApplyEnvironment = Pick<
  OboistEnvironment,
  'PRODUCTION' | 'SANDBOX' | 'RESUMAESTRO_CONFIG' | 'RESUMAESTRO_PIPELINE'
>;

export type DatabaseSelection = {
  database: DatabaseClient;
  name:
    | 'resumaestro-pipeline'
    | 'resumaestro-pipeline-sandbox'
    | 'resumaestro-pipeline-staging';
  target: Store;
};
