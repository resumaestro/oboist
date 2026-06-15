import { selectDatabase } from '#/database';
import { createJsonResponse, HttpError, parseJsonValue } from '#/http';
import { OperationRoute } from '#/types/routes';

type OperationMode = 'query' | 'exec';
type SqlParameter = string | number | null;

type OperationRequest = {
  database?: string;
  mode: OperationMode;
  parameters: SqlParameter[];
  sql: string;
};

export async function postOperation(
  route: OperationRoute,
  request: Request,
): Promise<Response> {
  const { target } = route;
  const value = await parseJsonValue(request);
  const operation = parseOperationRequest(value);
  const selected = selectDatabase(target, operation.database);
  let output: D1Result<unknown>;

  if (operation.mode === 'exec') {
    if (operation.parameters.length > 0) {
      throw new HttpError(400, 'params are not supported in exec mode');
    }
    output = await selected.database.prepare(operation.sql).run();
  } else {
    output = await selected.database
      .prepare(operation.sql)
      .bind(...operation.parameters)
      .all();
  }

  return createJsonResponse({
    database: selected.name,
    target: selected.target,
    mode: operation.mode,
    output,
  });
}

function parseOperationRequest(value: unknown): OperationRequest {
  const sql = readProperty(value, 'sql');
  if (typeof sql !== 'string' || sql.trim().length === 0) {
    throw new HttpError(400, 'sql must be a non-empty string');
  }

  const operation = {
    database: parseDatabase(readProperty(value, 'database')),
    mode: parseOperationMode(readProperty(value, 'mode')),
    parameters: parseParameters(readProperty(value, 'params')),
    sql,
  } satisfies OperationRequest;

  return operation;
}

function parseDatabase(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new HttpError(400, 'database must be a non-empty string');
  }

  return value;
}

function parseOperationMode(value: unknown): OperationMode {
  if (value === undefined || value === 'query') {
    return 'query';
  }

  if (value === 'exec') {
    return 'exec';
  }

  throw new HttpError(400, 'mode must be "query" or "exec"');
}

function parseParameters(value: unknown): SqlParameter[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new HttpError(400, 'params must be an array');
  }

  return value.map((parameter) => {
    if (
      parameter === null ||
      typeof parameter === 'string' ||
      (typeof parameter === 'number' && Number.isFinite(parameter))
    ) {
      return parameter;
    }

    if (typeof parameter === 'boolean') {
      return parameter ? 1 : 0;
    }

    throw new HttpError(
      400,
      'params may contain only strings, finite numbers, booleans, and null',
    );
  });
}

function readProperty(value: unknown, property: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HttpError(400, 'Request body must be a JSON object');
  }

  return Reflect.get(value, property);
}
