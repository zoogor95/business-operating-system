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

Tracked in `docs/bos-backlog.csv`: Docker Compose for Postgres/Redis/Mailpit
(BOS-003), ORM + migrations (BOS-004), CI (BOS-005), typed config (BOS-007).
