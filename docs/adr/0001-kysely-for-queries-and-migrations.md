# ADR-0001: Kysely for database access and migrations

- **Status:** Accepted
- **Date:** 2026-09-23
- **Ticket:** BOS-004

## Context

The API needs a way to query Postgres and a migration tool, chosen before the first tables
(BOS-010) land. The hard requirements come from our multi-tenancy design (shared schema +
Postgres Row-Level Security, BOS-011):

1. **Raw SQL everywhere it's needed.** RLS policies, `FORCE ROW LEVEL SECURITY`, roles, grants,
   functions and triggers are written as plain SQL in migrations. No DSL can express all of it.
2. **Per-transaction tenant context.** Every tenant-scoped request runs in a transaction that
   first sets `app.current_tenant` with `SET LOCAL` semantics, and every query of that request
   must run on the _same_ connection inside that transaction. The pool must never hand a
   connection with a stale tenant to someone else.
3. **Reversible migrations** (up and down), runnable from a CLI in dev, CI and deploys.
4. Type-safe queries in strict TypeScript, and something that fits a NestJS CommonJS build.

## Options considered

| Option      | Raw SQL / RLS                                                                                                                         | `SET LOCAL` per transaction                                                                                                                                              | Down migrations                                        | Notes                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| **Prisma**  | `$queryRaw` works, but the schema file can't describe policies; RLS lives in hand-edited SQL migrations the schema doesn't know about | Only via interactive `$transaction`, which has timeouts and a separate code path; the common pattern is a client extension that wraps every query in its own transaction | No (`migrate diff` workarounds only)                   | Heavy engine/codegen step; the least control over connections                                      |
| **Drizzle** | Good (`sql` template), policies partly modelled in the schema                                                                         | Good (`db.transaction(tx => …)`)                                                                                                                                         | **No** — drizzle-kit generates forward-only migrations | Schema-as-code and generated migrations are attractive, but no down migrations fails a requirement |
| **TypeORM** | Good (`query()`, raw migrations)                                                                                                      | Possible via `QueryRunner`, easy to get wrong                                                                                                                            | Yes                                                    | Weakest type safety (entities ≠ query results), decorators on entities, slow-moving                |
| **Kysely**  | First-class: `sql` template with bound parameters, usable in queries and migrations                                                   | First-class: `db.transaction().execute(trx => …)` pins one connection; `trx` is passed explicitly                                                                        | Yes — built-in `Migrator` with `up`/`down`             | Query builder, not an ORM: no entities, no relations, no hidden queries                            |

## Decision

Use **Kysely** as the query builder and its built-in **`Migrator`** for migrations.

- `apps/api/src/db/database.ts` — `Database` (table → row types) and `createDb()`, a Kysely
  instance over a `pg` pool. Used by both the Nest app and the migration CLI.
- `apps/api/src/db/migrations/NNNN_name.ts` — migrations as TypeScript `up`/`down` functions,
  written mostly as raw SQL. They take `Kysely<unknown>` so they never depend on today's
  table types. They are registered in `migrations/index.ts` (a static list, because Kysely's
  `FileMigrationProvider` breaks on Windows paths). Applied migrations are tracked in the
  `kysely_migration` table; the migrator takes a lock so concurrent runs are safe.
- `apps/api/src/db/migrate.ts` — CLI: `latest | up | down | status`; run with `tsx` in dev and
  as `node dist/db/migrate.js` from the build. Migrations are **not** run on API boot.
- `DatabaseService.withTenant(tenantId, fn)` — opens a transaction, runs
  `select set_config('app.current_tenant', $1, true)` (the parameterised form of
  `SET LOCAL app.current_tenant = …`; `SET` itself can't take bind parameters), then runs `fn`
  with the transaction. The setting disappears on commit or rollback, so pooled connections
  never carry a tenant between requests. `current_tenant_id()` (migration 0001) reads it
  back as a `uuid`, or `null` outside a tenant transaction; RLS policies will use it.

## Consequences

- We write SQL-shaped code and keep `Database` row types in sync with migrations by hand.
  If that gets tedious, `kysely-codegen` can generate them from the live schema.
- No ORM conveniences (entity classes, lazy relations, unit-of-work). This is deliberate:
  every query is visible and runs on the connection you pass it.
- Code that must be tenant-scoped has to use the `trx` it's given, not `DatabaseService.db`.
  BOS-011 (non-`BYPASSRLS` app role + `FORCE ROW LEVEL SECURITY`) makes forgetting this fail
  closed: queries outside `withTenant()` see zero rows.
- Kysely 0.29 is ESM-only. The API stays CommonJS and loads it through Node's `require(esm)`,
  so the minimum Node version is now **22.12**.
- Migrations are forward-and-back in dev; in production we roll forward with a new migration
  rather than running `down` against live data.
