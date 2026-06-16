import { selectDatabase } from '#/database';
import { createJsonResponse, HttpError, parseJsonValue } from '#/http';
import { ApplyRollbackRoute } from '#/types/routes';
import { env } from 'cloudflare:workers';

export async function postApplyRollback(
  _route: ApplyRollbackRoute,
  request: Request,
): Promise<Response> {
  const { database } = selectDatabase('PRODUCTION', undefined);
  const value = await parseJsonValue(request);
  const { target, version } = parseRollbackRequest(value);

  const kv = resolveKv(target);
  const snapshotKv = resolveSnapshotKv(target);

  const snapshotRaw = await snapshotKv.get(`v${version}`);
  if (snapshotRaw === null) {
    throw new HttpError(404, `no snapshot found for ${target} v${version}`);
  }

  const snapshot: Record<string, string> = JSON.parse(snapshotRaw);

  // Delete all current keys
  let cursor: string | undefined;
  do {
    const page = await kv.list({ cursor });
    for (const item of page.keys) {
      await kv.delete(item.name);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor !== undefined);

  // Restore snapshot
  for (const [k, v] of Object.entries(snapshot)) {
    await kv.put(k, v);
  }

  await database
    .prepare(
      `INSERT INTO schema_operations (kind, version) VALUES ('config', ?)
       ON CONFLICT(kind) DO UPDATE SET version = excluded.version, applied_at = datetime('now')`,
    )
    .bind(version - 1)
    .all();

  return createJsonResponse({
    ok: true,
    target,
    restored_to_version: version - 1,
    keys_restored: Object.keys(snapshot).length,
  });
}

function resolveKv(target: string): KVNamespace {
  if (target === 'RESUMAESTRO_CONFIG') return env.RESUMAESTRO_CONFIG;
  if (target === 'RESUMAESTRO_PIPELINE') return env.RESUMAESTRO_PIPELINE;
  throw new HttpError(400, `unknown target: ${target}`);
}

function resolveSnapshotKv(target: string): KVNamespace {
  if (target === 'RESUMAESTRO_CONFIG') return env.RESUMAESTRO_CONFIG_SNAPSHOT;
  if (target === 'RESUMAESTRO_PIPELINE') return env.RESUMAESTRO_PIPELINE_SNAPSHOT;
  throw new HttpError(400, `unknown snapshot target: ${target}`);
}

function parseRollbackRequest(value: unknown): { target: string; version: number } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HttpError(400, 'Request body must be a JSON object');
  }

  const target = Reflect.get(value, 'target');
  if (typeof target !== 'string' || !target.trim()) {
    throw new HttpError(400, 'target must be a non-empty string');
  }

  const version = Reflect.get(value, 'version');
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new HttpError(400, 'version must be a positive integer');
  }

  return { target, version };
}
