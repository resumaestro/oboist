/// <reference types="@cloudflare/workers-types" />
import 'cloudflare:workers';

declare module 'cloudflare:workers' {
  type DatabaseStatement = {
    all(): Promise<D1Result<unknown>>;
    bind(...values: unknown[]): DatabaseStatement;
    run(): Promise<D1Result<unknown>>;
  };

  type DatabaseClient = Pick<D1Database, 'exec'> & {
    prepare(query: string): DatabaseStatement;
  };

  interface OboistEnvironment {
    CLOUDFLARE_ACCOUNT_ID: string;
    CLOUDFLARE_TOKEN: string;
    OBOIST_SECRET: string;
    PRODUCTION: DatabaseClient;
    SANDBOX: DatabaseClient;
    STAGING: DatabaseClient;
    RESUMAESTRO_CONFIG: KVNamespace;
    RESUMAESTRO_CONFIG_SNAPSHOT: KVNamespace;
    RESUMAESTRO_PIPELINE: KVNamespace;
    RESUMAESTRO_PIPELINE_SNAPSHOT: KVNamespace;
    SECRETS_STORE_ID: string;
    SLACK_APP_ID: string;
    SLACK_CONFIG_REFRESH_TOKEN: SecretsStoreSecret;
    SLACK_CONFIG_TOKEN: SecretsStoreSecret;
  }
  namespace Cloudflare {
    interface Env extends OboistEnvironment {}
  }
  interface Env extends OboistEnvironment {}
}
