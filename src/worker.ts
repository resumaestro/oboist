import { requireAuthorization } from './auth';
import { updateSlackManifest } from './admin';
import { executeApply } from './apply';
import { createJsonResponse, HttpError } from './http';
import { executeOperation } from './operations';
import { parseRoute } from './routing';
import { createSnapshotResponse } from './snapshots';
import { getStatus } from './status';
import type { OboistEnvironment } from './types';

async function handleRequest(
  request: Request,
  environment: OboistEnvironment,
): Promise<Response> {
  await requireAuthorization(request, environment.OBOIST_SECRET);

  const route = parseRoute(request, environment);

  switch (request.method) {
    case 'GET':
      switch (route.action) {
        case 'health':
          return createJsonResponse({ ok: true });
        case 'status':
          return getStatus(route.target, route.kind, environment);
        default:
          throw new HttpError(404, 'Not found');
      }
    case 'POST':
      switch (route.action) {
        case 'operation':
          return executeOperation(route.target, request, environment);
        case 'apply':
          return executeApply(request, environment);
        case 'snapshot':
          return createSnapshotResponse(route.target, request, environment);
        case 'updateManifest':
          return updateSlackManifest(request, environment);
        default:
          throw new HttpError(404, 'Not found');
      }
    default:
      throw new HttpError(405, 'Method not allowed');
  }
}

export const worker = {
  async fetch(
    request: Request,
    environment: OboistEnvironment,
  ): Promise<Response> {
    try {
      return await handleRequest(request, environment);
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

      console.error(JSON.stringify({ event: 'unhandled_error' }));
      return createJsonResponse(
        { error: 'Internal server error' },
        { status: 500 },
      );
    }
  },
} satisfies ExportedHandler<OboistEnvironment>;

export default worker;
