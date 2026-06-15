import { afterEach, describe, expect, it, vi } from "vitest";

import { worker } from "../src/worker";
import type {
  DatabaseClient,
  DatabaseStatement,
  OboistEnvironment,
} from "../src/types";

const SECRET = "test-oboist-secret";

type ResolveRows = (
  sql: string,
  parameters: unknown[],
) => unknown[]

type CreateDatabaseOptions = {
  resolveRows?: ResolveRows;
}

type CreateEnvironmentOptions = {
  accessToken?: string;
  production?: ReturnType<typeof createDatabase>;
  refreshToken?: string;
  sandbox?: ReturnType<typeof createDatabase>;
}

type CreateRequestOptions = {
  body?: unknown;
  token?: string;
}

function createDatabase(options: CreateDatabaseOptions = {}) {
  const { resolveRows = () => [] } = options;
  const exec = vi.fn().mockResolvedValue({
    count: 2,
    duration: 1,
  });
  const prepare = vi.fn((sql: string) => {
    let parameters: unknown[] = [];
    const createResult = (): D1Result<unknown> => ({
      results: resolveRows(sql, parameters),
      success: true,
      meta: {
        duration: 0,
        size_after: 0,
        rows_read: 0,
        rows_written: 0,
        last_row_id: 0,
        changed_db: false,
        changes: 0,
      },
    });
    const statement: DatabaseStatement = {
      bind(...values: unknown[]): DatabaseStatement {
        parameters = values;
        return statement;
      },
      async all(): Promise<D1Result<unknown>> {
        return createResult();
      },
    };
    return statement;
  });

  const binding = {
    exec,
    prepare,
  } satisfies DatabaseClient;

  return {
    binding,
    exec,
    prepare,
  };
}

function createEnvironment(
  options: CreateEnvironmentOptions = {},
): OboistEnvironment {
  const {
    accessToken = "xoxe-access",
    production = createDatabase(),
    refreshToken = "xoxe-refresh",
    sandbox = createDatabase(),
  } = options;

  return {
    CLOUDFLARE_ACCOUNT_ID: "account-id",
    CLOUDFLARE_TOKEN: "cloudflare-token",
    OBOIST_SECRET: SECRET,
    PRODUCTION: production.binding,
    SANDBOX: sandbox.binding,
    SECRETS_STORE_ID: "store-id",
    SLACK_APP_ID: "A123",
    SLACK_CONFIG_REFRESH_TOKEN: {
      get: vi.fn().mockResolvedValue(refreshToken),
    },
    SLACK_CONFIG_TOKEN: {
      get: vi.fn().mockResolvedValue(accessToken),
    },
  };
}

function createRequest(
  path: string,
  options: CreateRequestOptions = {},
): Request {
  const { body, token = SECRET } = options;

  return new Request(`https://oboist.test${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Oboist Worker", () => {
  it("requires OBOIST_SECRET on every request", async () => {
    const response = await worker.fetch(
      new Request("https://oboist.test/production/health"),
      createEnvironment(),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
  });

  it("runs a prepared query against the route database", async () => {
    const production = createDatabase({
      resolveRows: () => [{ version: 3 }],
    });
    const response = await worker.fetch(
      createRequest("/production/operation", {
        body: {
          sql: "SELECT version FROM schema_migrations WHERE version = ?",
          params: [3],
        },
      }),
      createEnvironment({ production }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      database: "resumaestro-pipeline",
      target: "production",
      mode: "query",
      output: {
        results: [{ version: 3 }],
      },
    });
    expect(production.prepare).toHaveBeenCalledWith(
      "SELECT version FROM schema_migrations WHERE version = ?",
    );
  });

  it("allows an explicit database to override the route default", async () => {
    const production = createDatabase();
    const sandbox = createDatabase({
      resolveRows: () => [{ target: "sandbox" }],
    });
    const response = await worker.fetch(
      createRequest("/production/operation", {
        body: {
          database: "sandbox",
          sql: "SELECT 'sandbox' AS target",
        },
      }),
      createEnvironment({ production, sandbox }),
    );

    expect(response.status).toBe(200);
    expect(production.prepare).not.toHaveBeenCalled();
    expect(sandbox.prepare).toHaveBeenCalledOnce();
  });

  it("executes multi-statement migration SQL in exec mode", async () => {
    const sandbox = createDatabase();
    const sql = "CREATE TABLE example (id INTEGER); INSERT INTO example VALUES (1);";
    const response = await worker.fetch(
      createRequest("/sandbox/operation", {
        body: {
          sql,
          mode: "exec",
        },
      }),
      createEnvironment({ sandbox }),
    );

    expect(response.status).toBe(200);
    expect(sandbox.exec).toHaveBeenCalledWith(sql);
  });

  it("streams a deterministic SQL snapshot", async () => {
    const sandbox = createDatabase({
      resolveRows: (sql, parameters) => {
        if (sql.includes("FROM sqlite_schema")) {
          return [
            {
              type: "table",
              name: "people",
              tbl_name: "people",
              sql: "CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT)",
            },
            {
              type: "index",
              name: "people_name",
              tbl_name: "people",
              sql: "CREATE INDEX people_name ON people(name)",
            },
          ];
        }

        if (sql.startsWith("PRAGMA table_xinfo")) {
          return [
            { cid: 0, name: "id", pk: 1, hidden: 0 },
            { cid: 1, name: "name", pk: 0, hidden: 0 },
          ];
        }

        if (sql.includes('FROM "people"') && parameters.at(1) === 0) {
          return [{ id: 1, name: "Ada's Team" }];
        }

        return [];
      },
    });
    const response = await worker.fetch(
      createRequest("/sandbox/snapshots/create", { body: {} }),
      createEnvironment({ sandbox }),
    );
    const snapshot = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/sql");
    expect(snapshot).toContain(
      "CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT);",
    );
    expect(snapshot).toContain(
      `INSERT INTO "people" ("id", "name") VALUES (1, 'Ada''s Team');`,
    );
    expect(snapshot).toContain("CREATE INDEX people_name ON people(name);");
    expect(snapshot).toContain("COMMIT;");
  });

  it("updates the Slack manifest through the admin route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        ok: true,
        permissions_updated: true,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await worker.fetch(
      createRequest("/admin/update-manifest", {
        body: {
          manifest: {
            display_information: {
              name: "Resumaestro",
            },
          },
        },
      }),
      createEnvironment(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      app_id: "A123",
      ok: true,
      rotated: null,
      slack: {
        permissions_updated: true,
      },
    });
    expect(fetchMock).toHaveBeenCalledOnce();

    const slackRequest = fetchMock.mock.calls.at(0);
    expect(slackRequest).toBeDefined();
    expect(slackRequest?.at(0)).toBe(
      "https://slack.com/api/apps.manifest.update",
    );
    const requestInit = slackRequest?.at(1);
    if (!(requestInit?.headers instanceof Headers)) {
      throw new Error("Slack request headers were not a Headers instance");
    }
    expect(requestInit.headers.get("authorization")).toBe(
      "Bearer xoxe-access",
    );
  });

  it("rotates expired Slack tokens and persists the new pair", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = String(input);

        if (url.endsWith("/apps.manifest.update")) {
          const authorization = new Headers(init?.headers).get("authorization");

          if (authorization === "Bearer xoxe-access") {
            return Response.json({ error: "token_expired", ok: false });
          }

          return Response.json({ ok: true, permissions_updated: false });
        }

        if (url.endsWith("/tooling.tokens.rotate")) {
          return Response.json({
            exp: 1234,
            ok: true,
            refresh_token: "xoxe-refresh-next",
            token: "xoxe-access-next",
          });
        }

        if (url.includes("?per_page=100")) {
          return Response.json({
            result: [
              { id: "access-id", name: "SLACK_CONFIG_TOKEN" },
              { id: "refresh-id", name: "SLACK_CONFIG_REFRESH_TOKEN" },
            ],
            success: true,
          });
        }

        if (init?.method === "PATCH") {
          return Response.json({ success: true });
        }

        return Response.json({ success: false }, { status: 500 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await worker.fetch(
      createRequest("/admin/update-manifest", {
        body: { manifest: { display_information: { name: "Resumaestro" } } },
      }),
      createEnvironment(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      rotated: {
        write_back: {
          persisted: true,
        },
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });
});
