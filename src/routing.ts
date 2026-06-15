import { HttpError } from './http';
import type { Store } from './types';
import { STORES } from './types';
import type { OboistEnvironment } from './types';

type HealthRoute = {
  action: 'health';
  target: string;
};

type OperationRoute = {
  action: 'operation';
  target: Store;
};

type SnapshotRoute = {
  action: 'snapshot';
  target: Store;
};

type ApplyRoute = {
  action: 'apply';
  target: Store | null;
};

type StatusRoute = {
  action: 'status';
  target: Store;
  kind: 'migration' | 'seed' | 'apply' | null;
};

type UpdateManifestRoute = {
  action: 'updateManifest';
};

const isStore = (target: string): target is Store =>
  STORES.has(target as Store);

export type Route =
  | HealthRoute
  | OperationRoute
  | SnapshotRoute
  | ApplyRoute
  | StatusRoute
  | UpdateManifestRoute;
const KINDS = new Set(['migration', 'apply', 'seed']);
const handleStatus = (
  request: Request,
  target: string,
  env: OboistEnvironment,
): StatusRoute => {
  if (!isStore(target)) {
    throw new HttpError(400, 'Unknown target');
  }
  const kind = new URL(request.url).searchParams.get('kind') ?? null;
  if (kind !== null && !KINDS.has(kind)) {
    throw new HttpError(400, 'Unknown kind');
  }

  return {
    action: 'status',
    target,
    kind: kind as 'migration' | 'seed' | 'apply' | null,
  };
};

export function parseRoute(request: Request, env: OboistEnvironment): Route {
  const pathname = new URL(request.url).pathname;
  const [route, target] = pathname.split('/').filter(Boolean);

  switch (route) {
    case 'admin':
      switch (target) {
        case 'update-manifest':
          return {
            action: 'updateManifest',
          };
      }
    case 'apply':
      return {
        action: 'apply',
        target: null,
      };
    case 'status':
      return handleStatus(request, target, env);
    case 'operation':
      if (!isStore(target)) {
        throw new HttpError(400, 'Unknown target');
      }
      return {
        action: 'operation',
        target,
      };
    case 'snapshot':
      if (!isStore(target)) {
        throw new HttpError(400, 'Unknown target');
      }
      return {
        action: 'snapshot',
        target,
      };
    default:
      throw new HttpError(404, 'Not found');
  }
}
