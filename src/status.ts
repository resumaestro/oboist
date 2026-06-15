import { selectDatabase } from './database';
import { createJsonResponse } from './http';
import type { OboistEnvironment, Store } from './types';

type OperationStatus = {
  version: number;
  applied_at: string | null;
};

type Status = {
  migration: OperationStatus;
  seed: OperationStatus;
  apply: OperationStatus;
};

type Kind = keyof Status;

const NONE: OperationStatus = { version: 0, applied_at: null };

export async function getStatus(
  target: Store,
  kind: Kind | null,
  environment: OboistEnvironment,
): Promise<Response> {
  const { database } = selectDatabase(target, undefined, environment);

  const result = await database
    .prepare("SELECT kind, version, applied_at FROM schema_operations WHERE kind IN ('migration', 'seed', 'apply')")
    .all() as D1Result<{ kind: string; version: number; applied_at: string }>;

  const byKind: Record<string, OperationStatus> = Object.fromEntries(
    result.results.map(r => [r.kind, { version: r.version, applied_at: r.applied_at }])
  );

  if (kind !== null) {
    return createJsonResponse(byKind[kind] ?? NONE);
  }

  const status: Status = {
    migration: byKind['migration'] ?? NONE,
    seed: byKind['seed'] ?? NONE,
    apply: byKind['apply'] ?? NONE,
  };

  return createJsonResponse(status);
}
