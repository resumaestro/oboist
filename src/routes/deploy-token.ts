import { createJsonResponse, HttpError, parseJsonValue } from '#/http';
import { DeployTokenCreateRoute, DeployTokenRemoveRoute } from '#/types/routes';
import { env } from 'cloudflare:workers';

const CLOUDFLARE_API_URL = 'https://api.cloudflare.com/client/v4';
const KV_DEPLOY_TOKEN_PREFIX = 'deploy_token:';

type CfTokenPolicy = {
  effect: 'allow';
  permission_groups: Array<{ id: string }>;
  resources: Record<string, string>;
};

type CfTokenCreateResponse = {
  success: boolean;
  result?: { id: string; value: string };
  errors?: unknown[];
};

type CfTokenDeleteResponse = {
  success: boolean;
  errors?: unknown[];
};


async function fetchPermissionGroups(): Promise<Array<{ id: string; name: string }>> {
  const response = await fetch(`${CLOUDFLARE_API_URL}/user/tokens/permission_groups`, {
    headers: { authorization: `Bearer ${env.CLOUDFLARE_TOKEN}` },
  });
  const result = await response.json() as { success: boolean; result?: Array<{ id: string; name: string }> };
  if (!result.success || !result.result) {
    throw new HttpError(500, 'Failed to fetch permission groups from Cloudflare');
  }
  return result.result;
}

export async function postDeployTokenCreate(
  _route: DeployTokenCreateRoute,
  request: Request,
): Promise<Response> {
  const body = await parseJsonValue(request);
  const { scopes } = parseCreateRequest(body);

  const allGroups = await fetchPermissionGroups();
  const groupsByName = new Map(allGroups.map((g) => [g.name, g.id]));

  const permissionGroups = scopes.map((scope) => {
    const id = groupsByName.get(scope);
    if (!id) throw new HttpError(400, `Unknown scope: ${scope}`);
    return { id };
  });

  const policies: CfTokenPolicy[] = [
    {
      effect: 'allow',
      permission_groups: permissionGroups,
      resources: { [`com.cloudflare.api.account.${env.CLOUDFLARE_ACCOUNT_ID}`]: '*' },
    },
  ];

  const response = await fetch(`${CLOUDFLARE_API_URL}/user/tokens`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.CLOUDFLARE_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: `deploy-${Date.now()}`,
      policies,
      condition: {
        request_ip: { not_in: [] },
      },
    }),
  });

  const result = await response.json() as CfTokenCreateResponse;
  if (!result.success || !result.result) {
    throw new HttpError(500, `Failed to create token: ${JSON.stringify(result.errors)}`);
  }

  const { id, value } = result.result;
  const createdAt = new Date().toISOString();
  await env.RESUMAESTRO_CONFIG.put(`${KV_DEPLOY_TOKEN_PREFIX}${id}`, createdAt);

  return createJsonResponse({ key: id, token: value });
}

export async function postDeployTokenRemove(
  _route: DeployTokenRemoveRoute,
  request: Request,
): Promise<Response> {
  const body = await parseJsonValue(request);
  const { key } = parseRemoveRequest(body);

  const response = await fetch(`${CLOUDFLARE_API_URL}/user/tokens/${key}`, {
    method: 'DELETE',
    headers: {
      authorization: `Bearer ${env.CLOUDFLARE_TOKEN}`,
    },
  });

  const result = await response.json() as CfTokenDeleteResponse;
  if (!result.success) {
    throw new HttpError(500, `Failed to delete token: ${JSON.stringify(result.errors)}`);
  }

  await env.RESUMAESTRO_CONFIG.delete(`${KV_DEPLOY_TOKEN_PREFIX}${key}`);

  return createJsonResponse({ ok: true, key });
}

function parseCreateRequest(body: unknown): { scopes: string[] } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new HttpError(400, 'Body must be a JSON object');
  }
  const scopes = Reflect.get(body, 'scopes');
  if (!Array.isArray(scopes) || scopes.some((s) => typeof s !== 'string')) {
    throw new HttpError(400, 'scopes must be an array of strings');
  }
  return { scopes };
}

function parseRemoveRequest(body: unknown): { key: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new HttpError(400, 'Body must be a JSON object');
  }
  const key = Reflect.get(body, 'key');
  if (typeof key !== 'string' || !key.trim()) {
    throw new HttpError(400, 'key must be a non-empty string');
  }
  return { key };
}
