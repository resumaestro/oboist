import type { Env, DatabaseClient } from 'cloudflare:workers';

export const STORE_NAMES = [
  'RESUMAESTRO_CONFIG',
  'RESUMAESTRO_PIPELINE',
  'PRODUCTION',
  'SANDBOX',
  'STAGING',
] as const;
export const STORES: Set<keyof Env> = new Set(STORE_NAMES);

export type Store = (typeof STORE_NAMES)[number];

export type DatabaseSelection = {
  database: DatabaseClient;
  name:
    | 'resumaestro-pipeline'
    | 'resumaestro-pipeline-sandbox'
    | 'resumaestro-pipeline-staging';
  target: Store;
};
