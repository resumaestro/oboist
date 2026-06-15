import { HttpError } from './http';
import type { DatabaseEnvironment, DatabaseSelection, Store } from './types';

export function selectDatabase(
  routeTarget: Store,
  requested: string | undefined,
  environment: DatabaseEnvironment,
): DatabaseSelection {
  const value = requested === undefined ? routeTarget : requested;

  switch (value) {
    case 'resumaestro-pipeline':
    case 'production':
      return {
        database: environment.PRODUCTION,
        name: 'resumaestro-pipeline',
        target: 'PRODUCTION',
      };
    case 'resumaestro-pipeline-sandbox':
    case 'sandbox':
      return {
        database: environment.SANDBOX,
        name: 'resumaestro-pipeline-sandbox',
        target: 'SANDBOX',
      };
    case 'resumaestro-pipeline-staging':
    case 'staging':
      return {
        database: environment.STAGING,
        name: 'resumaestro-pipeline-staging',
        target: 'STAGING',
      };
      default:
        throw new HttpError(400, `Environment database does not exist: ${value}`)
  }
}
