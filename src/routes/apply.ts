import { selectDatabase } from '#/database';
import { createJsonResponse, HttpError, parseJsonValue } from '#/http';
import { ApplyRoute } from '#/types/routes';
import { env } from 'cloudflare:workers';

type ApplyPayload = Record<string, string>;

type ApplyRequest = {
  version: number;
  file: string;
  payload: ApplyPayload;
  target: string;
};

export async function postApply(
  _route: ApplyRoute,
  request: Request,
): Promise<Response> {
  const { database } = selectDatabase('PRODUCTION', undefined);

  const key = new URL(request.url).searchParams.get('key') ?? '';
  const value = await parseJsonValue(request);
  const apply = parseApplyRequest(value, key);

  const kv = resolveKv(apply.target);

  const applied: Array<{ key: string; value: string }> = [];
  for (const [k, v] of Object.entries(apply.payload)) {
    await kv.put(k, v);
    applied.push({ key: k, value: v });
  }

  await database
    .prepare(
      `INSERT INTO schema_operations (kind, version) VALUES ('config', ?)
       ON CONFLICT(kind) DO UPDATE SET version = excluded.version, applied_at = datetime('now')`,
    )
    .bind(apply.version)
    .all();

  await database
    .prepare(
      `INSERT INTO schema_operation_logs (kind, version, sha) VALUES ('config', ?, ?)`,
    )
    .bind(apply.version, apply.file)
    .all();

  return createJsonResponse({
    skipped: false,
    version: apply.version,
    file: apply.file,
    target: apply.target,
    applied,
  });
}

function resolveKv(target: string): KVNamespace {
  if (target === 'RESUMAESTRO_CONFIG') {
    return env.RESUMAESTRO_CONFIG;
  }
  if (target === 'RESUMAESTRO_PIPELINE') {
    return env.RESUMAESTRO_PIPELINE;
  }
  throw new HttpError(400, `unknown target: ${target}`);
}

function parseApplyRequest(value: unknown, key: string): ApplyRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HttpError(400, 'Request body must be a JSON object');
  }

  const version = Reflect.get(value, 'version');
  if (
    typeof version !== 'number' ||
    !Number.isInteger(version) ||
    version < 0
  ) {
    throw new HttpError(400, 'version must be a non-negative integer');
  }

  const file = key || (Reflect.get(value, 'file') as string | undefined) || '';
  if (!file) {
    throw new HttpError(
      400,
      'file must be provided as ?key= query param or in the body',
    );
  }

  const target = Reflect.get(value, 'target');
  if (typeof target !== 'string' || !target.trim()) {
    throw new HttpError(400, 'target must be a non-empty string');
  }

  const payload = Reflect.get(value, 'payload');
  if (
    typeof payload !== 'object' ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw new HttpError(400, 'payload must be a JSON object');
  }

  for (const [k, v] of Object.entries(payload as object)) {
    if (typeof v !== 'string') {
      throw new HttpError(400, `payload.${k} must be a string`);
    }
  }

  return { version, file, target, payload: payload as ApplyPayload };
}
