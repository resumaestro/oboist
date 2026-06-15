import { createJsonResponse, HttpError, parseJsonValue } from '#/http';
import { UpdateManifestRoute } from '#/types/routes';
import { env } from "cloudflare:workers";

const CLOUDFLARE_API_URL = 'https://api.cloudflare.com/client/v4';
const SLACK_API_URL = 'https://slack.com/api';
const SLACK_CONFIG_TOKEN_NAME = 'SLACK_CONFIG_TOKEN';
const SLACK_CONFIG_REFRESH_TOKEN_NAME = 'SLACK_CONFIG_REFRESH_TOKEN';

const EXPIRED_SLACK_ERRORS = new Set([
  'invalid_auth',
  'not_authed',
  'token_expired',
]);


type SlackRequestOptions = {
  bearer?: string;
}

type ManifestRequest = {
  appId: string;
  manifest: string;
}

type SlackConfigTokenPair = {
  expiration?: number;
  refreshToken: string;
  token: string;
}

type TokenWriteBack = {
  detail?: string;
  persisted: boolean;
}

type SlackManifestResult = {
  error?: string;
  ok: boolean;
  permissionsUpdated: boolean;
  response: unknown;
}

type SecretsStoreIdentifier = {
  id: string;
  name: string;
}

export async function postUpdateManifest(
  route: UpdateManifestRoute,
  request: Request
): Promise<Response> {
  const manifestRequest = parseManifestRequest(
    await parseJsonValue(request),
  );

  try {
    const accessToken = await env.SLACK_CONFIG_TOKEN.get();
    const refreshToken = await env.SLACK_CONFIG_REFRESH_TOKEN.get();
    let manifestResult = await requestSlackManifestUpdate(
      manifestRequest,
      accessToken,
    );
    let rotatedTokens: SlackConfigTokenPair | undefined;

    if (
      !manifestResult.ok &&
      manifestResult.error !== undefined &&
      EXPIRED_SLACK_ERRORS.has(manifestResult.error)
    ) {
      rotatedTokens = await rotateSlackConfigToken(refreshToken);
      manifestResult = await requestSlackManifestUpdate(
        manifestRequest,
        rotatedTokens.token,
      );
    }

    const writeBack =
      rotatedTokens === undefined
        ? undefined
        : await persistSlackConfigTokens(rotatedTokens);

    return createManifestResponse(
      manifestRequest,
      manifestResult,
      rotatedTokens,
      writeBack,
    );
  } catch (error) {
    return createJsonResponse(
      {
        detail: createErrorMessage(error),
        error: 'update-manifest failed',
      },
      { status: 500 },
    );
  }
}

function parseManifestRequest(
  value: unknown,
): ManifestRequest {
  const manifestProperty = readOptionalProperty(value, 'manifest');
  const manifestValue =
    manifestProperty === undefined ? value : manifestProperty;

  if (isMissingManifest(manifestValue)) {
    throw new HttpError(400, 'missing manifest in request body');
  }

  const appIdProperty = readOptionalProperty(value, 'app_id');
  const appId =
    typeof appIdProperty === 'string' && appIdProperty.trim().length > 0
      ? appIdProperty
      : env.SLACK_APP_ID;

  if (!appId) {
    throw new HttpError(
      400,
      'missing app_id (body.app_id or SLACK_APP_ID var)',
    );
  }

  const manifest =
    typeof manifestValue === 'string'
      ? manifestValue
      : JSON.stringify(manifestValue);

  if (manifest === undefined) {
    throw new HttpError(400, 'manifest must be JSON serializable');
  }

  return { appId, manifest };
}

function isMissingManifest(value: unknown): boolean {
  if (value === undefined || value === null || value === '') {
    return true;
  }

  if (
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Reflect.ownKeys(value).length === 0
  ) {
    return true;
  }

  return false;
}

async function requestSlackManifestUpdate(
  manifestRequest: ManifestRequest,
  accessToken: string,
): Promise<SlackManifestResult> {
  const parameters = new URLSearchParams({
    app_id: manifestRequest.appId,
    manifest: manifestRequest.manifest,
  });
  const response = await requestSlackApi(
    'apps.manifest.update',
    parameters,
    { bearer: accessToken },
  );
  const ok = readBooleanProperty(response, 'ok') ?? false;

  return {
    error: readStringProperty(response, 'error'),
    ok,
    permissionsUpdated:
      readBooleanProperty(response, 'permissions_updated') ?? false,
    response,
  };
}

async function rotateSlackConfigToken(
  refreshToken: string,
): Promise<SlackConfigTokenPair> {
  const parameters = new URLSearchParams({
    refresh_token: refreshToken,
  });
  const response = await requestSlackApi('tooling.tokens.rotate', parameters);
  const ok = readBooleanProperty(response, 'ok') ?? false;

  if (!ok) {
    const error = readStringProperty(response, 'error') ?? 'unknown error';
    throw new Error(`tooling.tokens.rotate failed: ${error}`);
  }

  const token = readStringProperty(response, 'token');
  const nextRefreshToken = readStringProperty(response, 'refresh_token');
  const expiration = readNumberProperty(response, 'exp');

  if (!token || !nextRefreshToken) {
    throw new Error('tooling.tokens.rotate returned an invalid token pair');
  }

  return {
    expiration,
    refreshToken: nextRefreshToken,
    token,
  };
}

async function requestSlackApi(
  method: string,
  parameters: URLSearchParams,
  options: SlackRequestOptions = {},
): Promise<unknown> {
  const headers = new Headers({
    'content-type': 'application/x-www-form-urlencoded',
  });

  if (options.bearer) {
    headers.set('authorization', `Bearer ${options.bearer}`);
  }

  const response = await fetch(`${SLACK_API_URL}/${method}`, {
    body: parameters,
    headers,
    method: 'POST',
  });

  return response.json();
}

async function persistSlackConfigTokens(
  tokens: SlackConfigTokenPair,
): Promise<TokenWriteBack> {
  try {
    await patchSecretsStoreSecret(
      SLACK_CONFIG_TOKEN_NAME,
      tokens.token,
    );
    await patchSecretsStoreSecret(
      SLACK_CONFIG_REFRESH_TOKEN_NAME,
      tokens.refreshToken,
    );
    return { persisted: true };
  } catch (error) {
    return {
      detail: createErrorMessage(error),
      persisted: false,
    };
  }
}

async function patchSecretsStoreSecret(
  name: string,
  value: string,
): Promise<void> {
  const baseUrl =
    `${CLOUDFLARE_API_URL}/accounts/${env.CLOUDFLARE_ACCOUNT_ID}` +
    `/secrets_store/stores/${env.SECRETS_STORE_ID}/secrets`;
  const headers = new Headers({
    authorization: `Bearer ${env.CLOUDFLARE_TOKEN}`,
    'content-type': 'application/json',
  });
  const listResponse = await fetch(`${baseUrl}?per_page=100`, { headers });
  const identifier = findSecretsStoreIdentifier(
    await listResponse.json(),
    name,
  );
  const patchResponse = await fetch(`${baseUrl}/${identifier.id}`, {
    body: JSON.stringify({
      comment: `rotated ${new Date().toISOString()}`,
      value,
    }),
    headers,
    method: 'PATCH',
  });
  const patchResult: unknown = await patchResponse.json();

  if (readBooleanProperty(patchResult, 'success') !== true) {
    throw new Error(
      `patch ${name} failed: ${JSON.stringify(readOptionalProperty(patchResult, 'errors'))}`,
    );
  }
}

function findSecretsStoreIdentifier(
  value: unknown,
  name: string,
): SecretsStoreIdentifier {
  if (readBooleanProperty(value, 'success') !== true) {
    throw new Error(
      `list secrets failed: ${JSON.stringify(readOptionalProperty(value, 'errors'))}`,
    );
  }

  const result = readOptionalProperty(value, 'result');
  if (!Array.isArray(result)) {
    throw new Error('list secrets returned an invalid result');
  }

  for (const candidate of result) {
    const candidateName = readStringProperty(candidate, 'name');
    const candidateId = readStringProperty(candidate, 'id');

    if (candidateName === name && candidateId) {
      return { id: candidateId, name: candidateName };
    }
  }

  throw new Error(`secret not found in store: ${name}`);
}

function createManifestResponse(
  manifestRequest: ManifestRequest,
  manifestResult: SlackManifestResult,
  rotatedTokens: SlackConfigTokenPair | undefined,
  writeBack: TokenWriteBack | undefined,
): Response {
  const slack = manifestResult.ok
    ? { permissions_updated: manifestResult.permissionsUpdated }
    : manifestResult.response;
  const status = manifestResult.ok ? 200 : 502;

  if (rotatedTokens === undefined || writeBack === undefined) {
    return createJsonResponse(
      {
        app_id: manifestRequest.appId,
        ok: manifestResult.ok,
        rotated: null,
        slack,
      },
      { status },
    );
  }

  const rotated = writeBack.persisted
    ? { write_back: writeBack }
    : {
        new_tokens: {
          exp: rotatedTokens.expiration,
          refresh_token: rotatedTokens.refreshToken,
          token: rotatedTokens.token,
        },
        write_back: writeBack,
      };

  return createJsonResponse(
    {
      app_id: manifestRequest.appId,
      ok: manifestResult.ok,
      rotated,
      slack,
    },
    { status },
  );
}

function readBooleanProperty(
  value: unknown,
  property: string,
): boolean | undefined {
  const candidate = readOptionalProperty(value, property);
  return typeof candidate === 'boolean' ? candidate : undefined;
}

function readNumberProperty(
  value: unknown,
  property: string,
): number | undefined {
  const candidate = readOptionalProperty(value, property);
  return typeof candidate === 'number' && Number.isFinite(candidate)
    ? candidate
    : undefined;
}

function readStringProperty(
  value: unknown,
  property: string,
): string | undefined {
  const candidate = readOptionalProperty(value, property);
  return typeof candidate === 'string' ? candidate : undefined;
}

function readOptionalProperty(value: unknown, property: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  return Reflect.get(value, property);
}

function createErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
