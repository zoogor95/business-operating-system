# BOS — Business Operating System

A configurable, multi-tenant business management platform for small businesses.
See `docs/` for the architecture notes and backlog.

## Layout

```
.
├── apps/
│   ├── api/            NestJS modular monolith           → http://localhost:3000/api
│   ├── tenant-web/     React + Vite, the shop's app       → http://localhost:5173
│   └── admin-web/      React + Vite, platform admin app   → http://localhost:5174
├── packages/
│   └── shared/         Types, domain event contracts, permission & module keys
├── docs/               Architecture, ADRs, backlog
├── turbo.json          Task pipeline (build order, caching)
├── pnpm-workspace.yaml
└── tsconfig.base.json  Compiler options every package extends
```

Package names: `@bos/api`, `@bos/tenant-web`, `@bos/admin-web`, `@bos/shared`.

### How `@bos/shared` is consumed

`packages/shared` is built with `tsup` into both ESM (for the Vite apps) and CommonJS
(for the NestJS API), with type declarations. Apps depend on it as `"@bos/shared": "workspace:*"`.
Turborepo always builds it before any app (`dependsOn: ["^build"]`), and during `pnpm dev` it
rebuilds on change in watch mode.

Rules of thumb:

- Put things here only if **more than one app** needs them: DTO/response types, event
  contracts, permission keys, module keys, pure helpers.
- No framework code (no NestJS decorators, no React) and no runtime dependencies without a
  good reason — it ships to the browser.

## Prerequisites

- Node.js 22.12+ (`.nvmrc`)
- pnpm 10 — easiest via Corepack: `corepack enable` (the version is pinned in `package.json`)
- Docker Desktop (or any Docker Engine with Compose v2) for the local stack

## Local stack (Postgres, Redis, Mailpit)

```bash
cp .env.example .env   # once; Docker Compose and the API both read it
pnpm infra:up          # docker compose up -d --wait
```

| Service     | Host address          | Notes                                        |
| ----------- | --------------------- | -------------------------------------------- |
| Postgres 16 | `localhost:5433`      | owner / password / db: `bos` / `bos` / `bos` |
| Redis 7     | `localhost:6379`      | append-only persistence                      |
| Mailpit     | SMTP `localhost:1025` | catches every email the API sends in dev     |
|             | http://localhost:8025 | web inbox                                    |

Postgres is published on **5433**, not 5432, so it never collides with a Postgres installed
directly on your machine. Data lives in named volumes (`bos_postgres-data`, `bos_redis-data`);
`pnpm infra:down` stops the stack and keeps them, `pnpm infra:reset` deletes them.

`GET /api/health` pings all three and reports each as `up` (with latency) or `down` (with the
error); overall `status` is `degraded` if any is down. Both web apps show this on their start page.

## Database and migrations

The API uses [Kysely](https://kysely.dev) for queries and its migrator for schema changes —
see [ADR-0001](docs/adr/0001-kysely-for-queries-and-migrations.md) for why.

```bash
pnpm db:migrate    # apply all pending migrations
pnpm db:dev-role   # once per database: create the API's login role (local only)
pnpm db:verify     # check roles, RLS policies and tenant isolation
pnpm db:rollback   # undo the most recent one
pnpm db:status     # list applied / pending
```

Data model and rules: [docs/erd.md](docs/erd.md) and
[docs/database-conventions.md](docs/database-conventions.md).

- Migrations live in `apps/api/src/db/migrations/NNNN_name.ts` as `up`/`down` functions
  (mostly raw SQL via Kysely's `sql` template). Add the next number and register it in
  `migrations/index.ts`. Add the new tables' row types to `Database` in `src/db/database.ts`.
- They don't run on API boot. From a build: `node apps/api/dist/db/migrate.js latest`.
- Inject `DatabaseService` and use `db` for queries, `transaction(fn)` for a transaction, and
  `withTenant(tenantId, fn)` for anything tenant-scoped: it sets `app.current_tenant` for that
  transaction only (`SET LOCAL` semantics), which RLS policies read via `current_tenant_id()`.
  Run every query of the unit of work on the `trx` passed to `fn`.

### Two database roles, and Row-Level Security

- **The API** connects with `DATABASE_URL` as `bos_api`, a member of `bos_app` (migration 0003):
  no superuser, no `BYPASSRLS`. Every tenant-scoped table has RLS enabled and forced, so outside
  `withTenant()` those tables read as empty and reject writes, and inside it only that tenant's
  rows exist. A missing `WHERE tenant_id = …` can't leak data; Postgres refuses.
- **Migrations**, `db:verify` and `db:dev-role` connect with `MIGRATION_DATABASE_URL` as the
  database owner (`bos` locally).
- `pnpm db:dev-role` reads the user and password from `DATABASE_URL`, creates that login role and
  grants it `bos_app`. It only runs against localhost. In staging and production, create the
  login role yourself with a real password and `grant bos_app to <login>`.
- Rolling back migration 0003 drops `bos_app`; after re-applying it, run `pnpm db:dev-role`
  again.

### Creating a tenant-scoped table

Use the helpers in `apps/api/src/db/schema.ts` instead of writing the boilerplate by hand:

```ts
import { type Kysely, sql } from 'kysely';
import { createTenantTable } from '../schema';

export async function up(db: Kysely<unknown>): Promise<void> {
  await createTenantTable(db, 'customers', ['full_name text not null', 'phone_e164 text'], {
    softDelete: true,
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table customers`.execute(db);
}
```

It adds `id`, `tenant_id` (FK to `tenants`), the base columns (`created_at`/`_by`,
`updated_at`/`_by`, and `deleted_at` with `softDelete`), `unique (tenant_id, id)` for composite
foreign keys, the `updated_at` trigger, and RLS with the `tenant_isolation` policy. In
`database.ts`, give the row type `extends TenantScoped` (and `SoftDeletable`).
`pnpm db:verify` fails if any table with a `tenant_id` column is missing RLS or the policy.

## Scripts (run from the repo root)

| Command                                     | What it does                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| `pnpm install`                              | Install all workspace dependencies                                       |
| `pnpm dev`                                  | Build `shared`, then run API + both web apps in watch mode               |
| `pnpm build`                                | Production build of every package, in dependency order                   |
| `pnpm start`                                | Build, then run the built API and serve both web builds (`vite preview`) |
| `pnpm typecheck`                            | Type-check every package                                                 |
| `pnpm lint` / `lint:fix`                    | ESLint (type-aware) across the repo; warnings fail the run               |
| `pnpm format` / `format:check`              | Prettier write / check across the repo                                   |
| `pnpm dev:api` / `dev:tenant` / `dev:admin` | Run one app (plus the packages it depends on)                            |
| `pnpm infra:up` / `infra:down`              | Start (and wait for healthy) / stop the Docker stack                     |
| `pnpm infra:reset` / `infra:logs`           | Stop the stack and delete its data volumes / follow container logs       |
| `pnpm db:migrate` / `db:rollback`           | Apply pending migrations / undo the latest one                           |
| `pnpm db:status`                            | List applied and pending migrations                                      |
| `pnpm db:dev-role`                          | Create the API's local login role (`bos_api`, member of `bos_app`)       |
| `pnpm db:verify`                            | Check roles, RLS on every tenant table and tenant isolation              |

Run a script in one package directly with a filter, e.g. `pnpm --filter @bos/api build`.

## Code quality

- **TypeScript** — `tsconfig.base.json` enables `strict` plus `noUncheckedIndexedAccess`,
  `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch` and
  `noPropertyAccessFromIndexSignature` (so env vars are read as `process.env['PORT']`).
- **ESLint** — flat config in `eslint.config.mjs`: `typescript-eslint` strict + stylistic
  type-checked rules, React Hooks rules for the web apps, Nest-friendly tweaks for the API.
- **Prettier** — `.prettierrc.json`; ESLint defers all formatting to it.
- **Git hooks** (Husky, installed by `pnpm install`):
  - `pre-commit` runs `lint-staged`: `prettier --check` + ESLint on staged files. Unformatted
    code or any lint error/warning blocks the commit — run `pnpm format` / `pnpm lint:fix` and
    re-stage.
  - `commit-msg` runs commitlint with
    [Conventional Commits](https://www.conventionalcommits.org), e.g.
    `feat(sales): add deposit payments (BOS-051)`. Allowed types: `feat`, `fix`, `chore`,
    `docs`, `refactor`, `test`, `perf`, `build`, `ci`, `style`, `revert`.

## Smoke test

After `pnpm infra:up`, `pnpm db:migrate`, `pnpm db:dev-role` and `pnpm dev`, open http://localhost:5173 and http://localhost:5174. Each page calls
`GET /api/health` through the Vite dev proxy and lists the core modules imported from
`@bos/shared` — if you see "✅ bos-api is up", all three apps and the shared package are wired
correctly. You can also hit http://localhost:3000/api/health directly.

## Adding a package

1. Create `apps/<name>` or `packages/<name>` with a `package.json` named `@bos/<name>`.
2. Give it `build`, `dev`, `typecheck` scripts (Turborepo picks them up automatically).
3. Extend `../../tsconfig.base.json`.
4. Run `pnpm install` so the workspace links it.

## What's next

Tracked in `docs/bos-backlog.csv`: CI (BOS-005), test harness (BOS-006), typed config
(BOS-007), per-request tenant context (BOS-012), users and login (BOS-014).
