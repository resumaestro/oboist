import { HttpError } from '#/http';
import type { Store } from '#/types/database';
import { STORES } from '#/types/database';
import type { Route, StatusRoute } from '#/types/routes';


const isStore = (target?: string): target is Store =>
  !!target && STORES.has(target as Store);


const KINDS = new Set(['migration', 'apply', 'seed']);

const handleStatus = (
  request: Request,
  target: string,
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

export function parseRoute(request: Request): Route {
  const pathname = new URL(request.url).pathname;
  const [route, target, action] = pathname.split('/').filter(Boolean);

  switch (route) {
    case 'pit-boss':
      switch (target) {
        case 'update-manifest':
          return {
            action: 'updateManifest',
          };
        case 'secrets':
          switch (action) {
            case 'push':
              return { action: 'updateSecrets' };
            case 'sync':
              return { action: 'readSecrets' };
            default:
              throw new HttpError(404, 'Not found');
          }
        case 'token': {
          const params = new URL(request.url).searchParams;
          const kind = params.get('kind');
          if (kind === 'secret' || kind === 'variable') {
            const name = params.get('name');
            if (!name) {
              throw new HttpError(400, 'name is required');
            }
            return { action: 'token', kind, name };
          }
          throw new HttpError(400, 'kind must be "secret" or "variable"');
        }
        default:
          throw new HttpError(404, 'Not found');
      }
    case 'apply':
      if (target === 'rollback') {
        return { action: 'applyRollback' };
      }
      return {
        action: 'apply',
        target: null,
      };
    case 'status':
      return handleStatus(request, target);
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
