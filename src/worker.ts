import { requireAuthorization } from '#/auth';
import { createJsonResponse, HttpError } from '#/http';
import { postReadSecrets, postUpdateManifest, postUpdateSecrets } from '#/routes/admin';
import { postApply } from '#/routes/apply';
import { postApplyRollback } from '#/routes/apply-rollback';
import { postDeployTokenCreate, postDeployTokenRemove } from '#/routes/deploy-token';
import { postOperation } from '#/routes/operation';
import { postSnapshot } from '#/routes/snapshot';
import { getStatus } from '#/routes/status';
import { getToken } from '#/routes/token';
import { parseRoute } from '#/routing';

async function handleRequest(request: Request): Promise<Response> {
  await requireAuthorization(request);
  const route = parseRoute(request);

  switch (request.method) {
    case 'GET':
      switch (route.action) {
        case 'health':
          return createJsonResponse({ ok: true });
        case 'status':
          return getStatus(route, request);
        case 'token':
          return getToken(route);
        default:
          throw new HttpError(404, 'Not found');
      }
    case 'POST':
      switch (route.action) {
        case 'operation':
          return postOperation(route, request);
        case 'apply':
          return postApply(route, request);
        case 'applyRollback':
          return postApplyRollback(route, request);
        case 'deployTokenCreate':
          return postDeployTokenCreate(route, request);
        case 'deployTokenRemove':
          return postDeployTokenRemove(route, request);
        case 'snapshot':
          return postSnapshot(route, request);
        case 'updateManifest':
          return postUpdateManifest(route, request);
        case 'updateSecrets':
          return postUpdateSecrets(route, request);
        case 'readSecrets':
          return postReadSecrets(route, request);
        default:
          throw new HttpError(404, 'Not found');
      }
    default:
      throw new HttpError(405, 'Method not allowed');
  }
}

export const worker = {
  async fetch(request: Request): Promise<Response> {
    try {
      return await handleRequest(request);
    } catch (error) {
      if (error instanceof HttpError) {
        return createJsonResponse(
          { error: error.message },
          {
            authenticate: error.status === 401,
            status: error.status,
          },
        );
      }

      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      console.error(JSON.stringify({ event: 'unhandled_error', message, stack }));
      return createJsonResponse(
        { error: 'Internal server error' },
        { status: 500 },
      );
    }
  },
  } satisfies ExportedHandler<Env>;

export default worker;
