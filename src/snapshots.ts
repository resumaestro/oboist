import { createResponseInit } from "#/headers";
import { selectDatabase } from "./database";
import { HttpError, parseOptionalJsonValue } from "./http";
import type {
  DatabaseClient,
  DatabaseEnvironment,
  DatabaseSelection,
  Store,
} from "./types";

const SNAPSHOT_PAGE_SIZE = 500;

type SchemaRow = {
  type: "index" | "table" | "trigger" | "view";
  name: string;
  sql: string;
}

type ColumnRow = {
  columnId: number;
  name: string;
  hidden: number;
  primaryKey: number;
}

export async function createSnapshotResponse(
  target: Store,
  request: Request,
  environment: DatabaseEnvironment,
): Promise<Response> {
  const value = await parseOptionalJsonValue(request);
  const selected = selectDatabase(
    target,
    parseSnapshotDatabase(value),
    environment,
  );
  const schema = await readSchema(selected.database);
  const snapshot = createSnapshotStream(selected, schema);
  const responseInit = createResponseInit("html");
  const headers = new Headers(responseInit.headers);

  headers.set(
    "content-disposition",
    `attachment; filename="${selected.name}.sql"`,
  );
  headers.set("content-type", "application/sql; charset=utf-8");
  headers.set("x-oboist-database", selected.name);
  headers.set("x-oboist-target", selected.target);
  responseInit.headers = headers;

  return new Response(snapshot, responseInit);
}

function parseSnapshotDatabase(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const database = readProperty(value, "database", "Snapshot body");
  if (database === undefined) {
    return undefined;
  }

  if (typeof database !== "string" || database.trim().length === 0) {
    throw new HttpError(400, "database must be a non-empty string");
  }

  return database;
}

async function readSchema(database: DatabaseClient): Promise<SchemaRow[]> {
  const result = await database
    .prepare(
      `SELECT type, name, sql
       FROM sqlite_schema
       WHERE sql IS NOT NULL
         AND name NOT LIKE 'sqlite_%'
       ORDER BY
         CASE type
           WHEN 'table' THEN 0
           WHEN 'index' THEN 1
           WHEN 'trigger' THEN 2
           WHEN 'view' THEN 3
           ELSE 4
         END,
         name`,
    )
    .all();

  return result.results.map(parseSchemaRow);
}

function createSnapshotStream(
  selected: DatabaseSelection,
  schema: SchemaRow[],
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (value: string) => controller.enqueue(encoder.encode(value));

      try {
        write(`-- oboist snapshot: ${selected.name}\n`);
        write("PRAGMA foreign_keys=OFF;\n");
        write("BEGIN TRANSACTION;\n\n");

        const tables = schema.filter((entry) => entry.type === "table");
        const deferred = schema.filter((entry) => entry.type !== "table");

        for (const table of tables) {
          write(`${terminateStatement(table.sql)}\n`);
          await writeTableRows(selected.database, table, write);
          write("\n");
        }

        for (const entry of deferred) {
          write(`${terminateStatement(entry.sql)}\n`);
        }

        write("\nCOMMIT;\n");
        write("PRAGMA foreign_keys=ON;\n");
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

async function writeTableRows(
  database: DatabaseClient,
  table: SchemaRow,
  write: (value: string) => void,
): Promise<void> {
  const columnsResult = await database
    .prepare(`PRAGMA table_xinfo(${quoteIdentifier(table.name)})`)
    .all();
  const columns = columnsResult.results
    .map(parseColumnRow)
    .filter((column) => column.hidden === 0)
    .sort((left, right) => left.columnId - right.columnId);

  if (columns.length === 0) {
    return;
  }

  const primaryKey = columns
    .filter((column) => column.primaryKey > 0)
    .sort((left, right) => left.primaryKey - right.primaryKey)
    .map((column) => quoteIdentifier(column.name));
  const orderBy =
    primaryKey.length > 0 ? primaryKey.join(", ") : quoteIdentifier("rowid");
  const columnList = columns
    .map((column) => quoteIdentifier(column.name))
    .join(", ");
  let offset = 0;

  while (true) {
    const rows = await database
      .prepare(
        `SELECT ${columnList}
         FROM ${quoteIdentifier(table.name)}
         ORDER BY ${orderBy}
         LIMIT ? OFFSET ?`,
      )
      .bind(SNAPSHOT_PAGE_SIZE, offset)
      .all();

    for (const row of rows.results) {
      const values = columns
        .map((column) =>
          createSqlLiteral(readProperty(row, column.name, "Snapshot row")),
        )
        .join(", ");
      write(
        `INSERT INTO ${quoteIdentifier(table.name)} (${columnList}) VALUES (${values});\n`,
      );
    }

    if (rows.results.length < SNAPSHOT_PAGE_SIZE) {
      return;
    }

    offset += rows.results.length;
  }
}

function terminateStatement(sql: string): string {
  const trimmed = sql.trimEnd();
  return trimmed.endsWith(";") ? trimmed : `${trimmed};`;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function createSqlLiteral(value: unknown): string {
  if (value === null || value === undefined) {
    return "NULL";
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "string") {
    return `'${value.replaceAll("'", "''")}'`;
  }

  const bytes =
    value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : ArrayBuffer.isView(value)
        ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        : null;
  if (!bytes) {
    throw new Error("Snapshot contains an unsupported D1 value");
  }

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
  return `X'${hex}'`;
}

function parseSchemaRow(value: unknown): SchemaRow {
  const type = readProperty(value, "type", "D1 schema row");
  const name = readProperty(value, "name", "D1 schema row");
  const sql = readProperty(value, "sql", "D1 schema row");

  if (!isSchemaType(type)) {
    throw new Error("D1 returned an unsupported schema type");
  }

  if (typeof name !== "string" || typeof sql !== "string") {
    throw new Error("D1 returned an invalid schema row");
  }

  return { name, sql, type };
}

function parseColumnRow(value: unknown): ColumnRow {
  const columnId = readProperty(value, "cid", "D1 column row");
  const hidden = readProperty(value, "hidden", "D1 column row");
  const name = readProperty(value, "name", "D1 column row");
  const primaryKey = readProperty(value, "pk", "D1 column row");

  if (
    typeof columnId !== "number" ||
    typeof hidden !== "number" ||
    typeof name !== "string" ||
    typeof primaryKey !== "number"
  ) {
    throw new Error("D1 returned an invalid column row");
  }

  return {
    columnId,
    hidden,
    name,
    primaryKey,
  };
}

function isSchemaType(value: unknown): value is SchemaRow["type"] {
  return (
    value === "index" ||
    value === "table" ||
    value === "trigger" ||
    value === "view"
  );
}

function readProperty(
  value: unknown,
  property: string,
  context: string,
): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }

  return Reflect.get(value, property);
}
