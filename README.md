# Oboist

Authenticated D1 operations and snapshots for Pit Boss.

## Bindings

- `PRODUCTION`: `resumaestro-pipeline`
- `SANDBOX`: `resumaestro-pipeline-sandbox`
- `OBOIST_SECRET`: bearer secret required on every request

Set the deployed secret with:

```sh
npx wrangler secret put OBOIST_SECRET
```

For local development, copy `.env.example` to `.env` and set a local value.

## API

Every request requires:

```http
Authorization: Bearer <OBOIST_SECRET>
```

### Execute SQL

```http
POST /production/operation
POST /sandbox/operation
POST /staging/operation
Content-Type: application/json

{
  "sql": "SELECT * FROM schema_migrations",
  "params": [],
  "mode": "query",
  "database": "sandbox"
}
```

`database` is optional and overrides the route default. Accepted values are
`production`, `sandbox`, `staging`, `resumaestro-pipeline`, and
`resumaestro-pipeline-sandbox`.

Use `mode: "query"` for one prepared statement and `mode: "exec"` for a SQL
script containing multiple statements. `exec` does not accept parameters.

### Create Snapshot

```http
POST /production/snapshots/create
POST /sandbox/snapshots/create
POST /staging/snapshots/create
Content-Type: application/json

{
  "database": "sandbox"
}
```

The response is a deterministic SQL dump with content type `application/sql`.

