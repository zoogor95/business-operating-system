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

- Node.js 22+ (`.nvmrc`)
- pnpm 10 — easiest via Corepack: `corepack enable` (the version is pinned in `package.json`)

## Scripts (run from the repo root)

| Command | What it does |
| --- | --- |
| `pnpm install` | Install all workspace dependencies |
| `pnpm dev` | Build `shared`, then run API + both web apps in watch mode |
| `pnpm build` | Production build of every package, in dependency order |
| `pnpm start` | Build, then run the built API and serve both web builds (`vite preview`) |
| `pnpm typecheck` | Type-check every package |
| `pnpm dev:api` / `dev:tenant` / `dev:admin` | Run one app (plus the packages it depends on) |

Run a script in one package directly with a filter, e.g. `pnpm --filter @bos/api build`.

## Smoke test

After `pnpm dev`, open http://localhost:5173 and http://localhost:5174. Each page calls
`GET /api/health` through the Vite dev proxy and lists the core modules imported from
`@bos/shared` — if you see "✅ bos-api is up", all three apps and the shared package are wired
correctly. You can also hit http://localhost:3000/api/health directly.

## Adding a package

1. Create `apps/<name>` or `packages/<name>` with a `package.json` named `@bos/<name>`.
2. Give it `build`, `dev`, `typecheck` scripts (Turborepo picks them up automatically).
3. Extend `../../tsconfig.base.json`.
4. Run `pnpm install` so the workspace links it.

## What's next

Tracked in `docs/bos-backlog.csv`: lint/format/hooks (BOS-002), Docker Compose for Postgres/Redis/Mailpit
(BOS-003), ORM + migrations (BOS-004), CI (BOS-005), typed config (BOS-007).
