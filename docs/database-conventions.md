# Database conventions

Ticket: **BOS-167**. These rules apply to every migration from BOS-010 onward. The table map is in [erd.md](erd.md). Why we use Kysely and raw-SQL migrations is in [ADR-0001](adr/0001-kysely-for-queries-and-migrations.md).

## Naming

| Thing              | Rule                                                     | Example                              |
| ------------------ | -------------------------------------------------------- | ------------------------------------ |
| Tables             | `snake_case`, plural                                     | `order_lines`, `stock_movements`     |
| Columns            | `snake_case`, singular                                   | `promised_date`                      |
| Foreign keys       | `<referenced table, singular>_id`                        | `customer_id`, `variant_id`          |
| Money              | `<name>_minor`, `bigint` (sen for MYR)                   | `total_minor`, `unit_cost_minor`     |
| Booleans           | `is_` / `has_` prefix, or a plain adjective when obvious | `is_default`, `enabled`              |
| Timestamps         | `<event>_at`, `timestamptz`                              | `completed_at`                       |
| Dates (no time)    | `<event>_date` / `_on`, `date`                           | `expense_date`, `issued_on`          |
| Indexes            | `ix_<table>__<col>_<col>`                                | `ix_orders__tenant_id_status`        |
| Unique constraints | `uq_<table>__<cols>`                                     | `uq_product_variants__tenant_id_sku` |
| Check constraints  | `ck_<table>__<rule>`                                     | `ck_journal_lines__one_side`         |
| RLS policies       | `tenant_isolation` (one per table)                       |                                      |

## Keys

- **Primary keys:** `id uuid primary key default gen_random_uuid()`. Never expose sequential integer ids.
- **Human-facing numbers** (`ORD-10294`, `RCPT-…`) are separate columns, allocated from `document_sequences` and unique per tenant.
- **References between tenant tables use composite foreign keys:** `foreign key (tenant_id, customer_id) references customers (tenant_id, id)`. Every tenant table therefore has `unique (tenant_id, id)`. Postgres then refuses a row that points at another tenant's data, even if application code gets it wrong.
- **Natural uniqueness is always per tenant:** `unique (tenant_id, sku)`, never `unique (sku)`.

## Tenant-scoped tables

Every table that holds a business's data:

1. Has `tenant_id uuid not null` as its first column after `id`.
2. Has RLS enabled **and forced**, with the one standard policy:
   ```sql
   alter table <t> enable row level security;
   alter table <t> force row level security;
   create policy tenant_isolation on <t>
     using (tenant_id = current_tenant_id())
     with check (tenant_id = current_tenant_id());
   ```
   BOS-011 wraps this in a migration helper. Use the helper rather than writing it by hand.
3. Is queried only inside `DatabaseService.withTenant(tenantId, trx => …)`, using that `trx`.
4. Leads every index with `tenant_id`, e.g. `(tenant_id, status)` or `(tenant_id, created_at desc)`.

Platform tables (`tenants`, `users`, `modules`, `business_type_templates`, `platform_admins`) have no `tenant_id` and no RLS. The tenant app reaches `users` only through `tenant_memberships`.

## Base columns

Mutable master data (customers, products, settings, …):

```sql
created_at timestamptz not null default now(),
created_by uuid,            -- users.id; null for system/provisioning
updated_at timestamptz not null default now(),
updated_by uuid,
deleted_at timestamptz      -- only where soft delete applies
```

Attach `set_updated_at()` (migration 0001) with `before update … for each row`.

**Append-only ledgers** have `created_at`/`created_by` only and are never updated or deleted by the app role. This covers `stock_movements`, `journal_entries`, `journal_lines`, `payments`, `order_status_history`, `audit_log` and `outbox_events`. Corrections are new rows: a reversing journal entry, a compensating stock movement, or a refund payment.

## Soft delete

- **Master data only:** `customers`, `products`, `product_variants`, `suppliers`. Set `deleted_at`, and make default queries filter `deleted_at is null`.
- **Never on ledgers or orders.** Orders are cancelled through their workflow status, not deleted.
- **PDPA anonymisation** (BOS-039) overwrites PII columns in place and keeps the row so financial history stays intact.

## Money and numbers

- **Money:** `bigint` minor units (sen). No `numeric` or floats for money in the database or in TypeScript. One currency per tenant (`tenants.currency`).
- **Rates** (tax, discount percentages): `numeric(6,4)`, e.g. `0.0800`.
- **Rounding** happens in one shared helper (BOS-028); the database stores already-rounded values.
- **Optical values** (SPH, CYL, ADD, PD): `numeric(5,2)`, with check constraints for range and 0.25 steps where they apply.

## Enums and flexible data

- **Use `text` + a check constraint** (`check (status in ('trial','active','suspended','cancelled'))`) rather than Postgres `enum` types. They're easier to change in a migration.
- **Workflow statuses are not constrained in SQL**, because each tenant's workflow defines its own. The workflow engine validates them (BOS-048).
- **`jsonb` is only for data that genuinely varies by tenant or category:** product attributes, module config, workflow definitions, lens job details, address. Validate it with a zod schema in the API, and don't put anything there that you need to join or sum on.

## Time

- **Store** `timestamptz` (UTC); never `timestamp` without a time zone.
- **Day boundaries** for reports and numbering use the tenant's `timezone` (default `Asia/Kuala_Lumpur`), applied in queries, never by storing local times.

## Migrations

- **Files:** `apps/api/src/db/migrations/NNNN_name.ts`, registered in `migrations/index.ts`, with both `up` and `down`.
- **One concern per migration;** mostly raw SQL via Kysely's `sql` template.
- **Expand/contract for anything already deployed:** add the new column, backfill, switch reads, then drop the old one in a later migration.
- **Add row types** to `Database` in `src/db/database.ts` in the same PR as the migration.
- **Seed/reference data** (modules, permissions, chart of accounts, tax rates, templates) ships as idempotent migrations (BOS-169). Demo data is separate (BOS-076).
