import { HttpError } from '#/http';
import type { DatabaseSelection, Store } from '#/types/database';
import { env } from "cloudflare:workers";


export function selectDatabase(
  routeTarget: Store,
  requested: string | undefined,
): DatabaseSelection {
  const value = requested === undefined ? routeTarget : requested;

  switch (value) {
    case 'resumaestro-pipeline':
    case 'production':
      return {
        database: env.PRODUCTION,
        name: 'resumaestro-pipeline',
        target: 'PRODUCTION',
      };
    case 'resumaestro-pipeline-sandbox':
    case 'sandbox':
      return {
        database: env.SANDBOX,
        name: 'resumaestro-pipeline-sandbox',
        target: 'SANDBOX',
      };
    case 'resumaestro-pipeline-staging':
    case 'staging':
      return {
        database: env.STAGING,
        name: 'resumaestro-pipeline-staging',
        target: 'STAGING',
      };
      default:
        throw new HttpError(400, `Environment database does not exist: ${value}`)
  }
}
