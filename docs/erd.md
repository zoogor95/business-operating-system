# BOS core data model (ERD)

Ticket: **BOS-167**. Status: **Draft, ready for review.**

This is the target schema for P1 (Foundations) and P2 (Optical MVP). The tables are created ticket by ticket in later migrations, so this doc is the map they follow. Naming, keys and other rules are in [database-conventions.md](database-conventions.md).

Diagrams are split by domain so they stay readable. A table drawn in one diagram may be referenced from another by its `*_id` column. Every tenant-scoped table also carries the base columns (`created_at`, `created_by`, `updated_at`, `updated_by`, and `deleted_at` where soft delete applies). The diagrams leave them out.

**Legend:**

- 🌐 Platform tables: no `tenant_id`, no RLS. Reached only by the platform admin app or by provisioning.
- 🔒 Tenant tables: `tenant_id` plus an RLS policy `tenant_id = current_tenant_id()`.

---

## 1. Platform, identity and tenancy

```mermaid
erDiagram
    tenants ||--o{ tenant_memberships : has
    users ||--o{ tenant_memberships : "belongs via"
    roles ||--o{ tenant_memberships : grants
    roles ||--o{ role_permissions : has
    tenants ||--o{ roles : defines
    tenants ||--o{ tenant_modules : enables
    modules ||--o{ tenant_modules : "enabled as"
    business_type_templates ||--o{ tenants : "seeded from"
    tenants ||--o{ locations : has
    tenants ||--o{ document_sequences : numbers

    tenants {
        uuid id PK
        text slug UK
        text name
        text business_type "optical, general_retail"
        uuid template_id FK
        text status "trial, active, suspended, cancelled"
        text timezone "Asia/Kuala_Lumpur"
        text currency "MYR"
        jsonb profile "SSM no, SST no, address, logo file"
    }
    users {
        uuid id PK
        text email UK "global identity, citext"
        text password_hash "argon2id"
        text full_name
        timestamptz email_verified_at
    }
    tenant_memberships {
        uuid id PK
        uuid tenant_id FK
        uuid user_id FK
        uuid role_id FK
        text status "invited, active, disabled"
    }
    roles {
        uuid id PK
        uuid tenant_id FK
        text key "owner, staff, custom"
        text name
        boolean is_system
    }
    role_permissions {
        uuid tenant_id FK
        uuid role_id PK
        text permission_key PK "sales.refund, keys from shared package"
    }
    modules {
        text key PK "sales, inventory, prescriptions"
        text name
        text category "core, optional, vertical"
        text depends_on "array of module keys"
    }
    tenant_modules {
        uuid tenant_id PK
        text module_key PK
        boolean enabled
        jsonb config "validated by the module's zod schema"
    }
    business_type_templates {
        uuid id PK
        text key UK "optical, general_retail"
        int version
        jsonb definition "modules, roles, categories, workflow, tax"
    }
    locations {
        uuid id PK
        uuid tenant_id FK
        text name
        boolean is_default
    }
    document_sequences {
        uuid tenant_id PK
        text doc_type PK "ORD, INV, RCPT, PO"
        text prefix
        int padding
        bigint next_value
    }
```

| Table                                                              | Scope | Notes                                                                                                                                                |
| ------------------------------------------------------------------ | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tenants`, `modules`, `business_type_templates`, `platform_admins` | 🌐    | `platform_admins` (not drawn) belongs to the admin app's separate auth (BOS-032)                                                                     |
| `users`                                                            | 🌐    | Global identity, so one email can belong to several tenants. Never exposed across tenants: tenant queries reach it only through `tenant_memberships` |
| everything else above                                              | 🔒    |                                                                                                                                                      |

## 2. Customers, catalog and inventory

```mermaid
erDiagram
    customers ||--o{ orders : places
    product_categories ||--o{ product_categories : "parent of"
    product_categories ||--o{ products : groups
    products ||--o{ product_variants : has
    tax_classes ||--o{ products : "taxed as"
    tax_classes ||--o{ tax_rates : has
    product_variants ||--o{ stock_levels : "stocked as"
    locations ||--o{ stock_levels : holds
    product_variants ||--o{ stock_movements : moves
    product_variants ||--o{ stock_reservations : reserves
    product_variants ||--o{ price_history : "priced over time"

    customers {
        uuid id PK
        uuid tenant_id FK
        text full_name
        text phone_e164 "dup warning per tenant"
        text email
        date date_of_birth
        text ic_number "optional, PII"
        jsonb address
        text notes
        boolean marketing_consent
        timestamptz consent_at
        timestamptz deleted_at
    }
    product_categories {
        uuid id PK
        uuid tenant_id FK
        uuid parent_id FK
        text name "Frames, Lenses, Contact lenses"
        jsonb attribute_schema "fields and types for products in this category"
    }
    products {
        uuid id PK
        uuid tenant_id FK
        uuid category_id FK
        uuid tax_class_id FK
        text name
        text kind "stock, service"
        jsonb attributes "validated against category attribute_schema"
        timestamptz deleted_at
    }
    product_variants {
        uuid id PK
        uuid tenant_id FK
        uuid product_id FK
        text sku UK "unique per tenant"
        text barcode "unique per tenant when set"
        jsonb options "colour, size"
        bigint price_minor
        bigint avg_cost_minor
        boolean track_stock
        int reorder_level
    }
    price_history {
        uuid id PK
        uuid tenant_id FK
        uuid variant_id FK
        bigint price_minor
        timestamptz effective_at
    }
    tax_classes {
        uuid id PK
        uuid tenant_id FK
        text name "standard, exempt"
    }
    tax_rates {
        uuid id PK
        uuid tenant_id FK
        uuid tax_class_id FK
        numeric rate "0.06, 0.08"
        date valid_from
        date valid_to
    }
    stock_levels {
        uuid tenant_id PK
        uuid variant_id PK
        uuid location_id PK
        int on_hand "kept equal to sum of movements"
        int reserved
    }
    stock_movements {
        uuid id PK
        uuid tenant_id FK
        uuid variant_id FK
        uuid location_id FK
        int qty_delta "+ in, - out"
        text reason "receive, sale, return, adjust, transfer"
        text ref_type "order, adjustment, po"
        uuid ref_id
        bigint unit_cost_minor
        timestamptz occurred_at
    }
    stock_reservations {
        uuid id PK
        uuid tenant_id FK
        uuid variant_id FK
        uuid location_id FK
        uuid order_line_id FK
        int qty
        text status "active, consumed, released"
    }
```

`stock_movements` is **append-only**: no updates or deletes, and corrections are new movements. `stock_levels` is a maintained projection that a reconciliation test checks (BOS-042).

## 3. Sales, orders and payments (core)

```mermaid
erDiagram
    customers ||--o{ orders : places
    locations ||--o{ orders : "taken at"
    orders ||--|{ order_lines : contains
    product_variants ||--o{ order_lines : "sold as"
    orders ||--o{ order_status_history : "moves through"
    workflow_definitions ||--o{ orders : governs
    orders ||--o{ payments : "paid by"
    cash_sessions ||--o{ payments : "collected in"
    order_lines ||--o{ stock_reservations : holds

    workflow_definitions {
        uuid id PK
        uuid tenant_id FK
        text key "optical_job, retail_sale"
        int version
        jsonb states "states, transitions, permission, emitted events"
    }
    orders {
        uuid id PK
        uuid tenant_id FK
        text number UK "ORD-10294, unique per tenant"
        uuid customer_id FK "null for anonymous walk-in"
        uuid location_id FK
        uuid workflow_id FK
        text status "current state key"
        bigint subtotal_minor
        bigint discount_minor
        bigint tax_minor
        bigint total_minor
        bigint paid_minor
        bigint balance_minor "total - paid"
        date promised_date
        timestamptz completed_at
        uuid created_by FK
    }
    order_lines {
        uuid id PK
        uuid tenant_id FK
        uuid order_id FK
        uuid variant_id FK
        text description "snapshot of name at sale"
        int qty
        bigint unit_price_minor
        bigint discount_minor
        uuid tax_class_id FK
        numeric tax_rate "snapshot"
        bigint tax_minor
        bigint line_total_minor
        bigint unit_cost_minor "snapshot for COGS"
    }
    order_status_history {
        uuid id PK
        uuid tenant_id FK
        uuid order_id FK
        text from_status
        text to_status
        uuid changed_by FK
        timestamptz changed_at
        text note
    }
    payments {
        uuid id PK
        uuid tenant_id FK
        text number UK "RCPT-, unique per tenant"
        uuid order_id FK
        uuid cash_session_id FK
        text kind "payment, refund"
        text method "cash, card, duitnow_qr, ewallet"
        bigint amount_minor "positive; kind gives direction"
        text reference
        uuid received_by FK
        timestamptz received_at
    }
    cash_sessions {
        uuid id PK
        uuid tenant_id FK
        uuid location_id FK
        uuid opened_by FK
        bigint opening_float_minor
        bigint counted_minor
        timestamptz opened_at
        timestamptz closed_at
    }
```

- **Prices are copied onto order lines.** Price, tax rate, cost and description are copied at sale time, so later catalog edits never change past orders.
- **Order totals are always computed on the server.** `paid_minor` and `balance_minor` are updated in the same transaction as each payment.
- **Refunds are `payments` rows with `kind = refund`.** That keeps one cash trail. Returned items create `stock_movements` with `reason = return`.
- **No optical columns live here.** Sales stays vertical-free (see §5).

## 4. Accounting, expenses, platform plumbing

```mermaid
erDiagram
    accounts ||--o{ journal_lines : "posted to"
    journal_entries ||--|{ journal_lines : "balanced by"
    expense_categories ||--o{ expenses : groups
    expenses ||--o| journal_entries : "posts as"
    accounts ||--o{ expense_categories : "maps to"

    accounts {
        uuid id PK
        uuid tenant_id FK
        text code UK "1000 Cash, 4000 Revenue"
        text name
        text type "asset, liability, equity, revenue, expense"
        boolean is_system
    }
    journal_entries {
        uuid id PK
        uuid tenant_id FK
        date entry_date
        text source_type "order, payment, refund, expense, manual"
        uuid source_id
        uuid source_event_id UK "idempotency: one entry per event"
        uuid reverses_entry_id FK
        text memo
    }
    journal_lines {
        uuid id PK
        uuid tenant_id FK
        uuid entry_id FK
        uuid account_id FK
        bigint debit_minor
        bigint credit_minor
    }
    expense_categories {
        uuid id PK
        uuid tenant_id FK
        text name "Rent, Utilities"
        uuid account_id FK
    }
    expenses {
        uuid id PK
        uuid tenant_id FK
        uuid category_id FK
        date expense_date
        bigint amount_minor
        text method
        text vendor
        uuid receipt_file_id FK
        uuid journal_entry_id FK
    }
```

Not drawn, but part of the model:

| Table           | Scope | Purpose (ticket)                                                                                                                                                |
| --------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `outbox_events` | 🔒    | `id`, `tenant_id`, `type`, `version`, `payload jsonb`, `occurred_at`, `processed_at`. Domain events are written in the same transaction as the change (BOS-024) |
| `audit_log`     | 🔒    | `actor_id`, `action`, `entity`, `entity_id`, `before`/`after jsonb`, `ip`, `at`. Append-only; the app role has no UPDATE or DELETE (BOS-025)                    |
| `files`         | 🔒    | `storage_key` (tenant-prefixed), `content_type`, `size`, `uploaded_by`. Used by receipts, logos and product images (BOS-027)                                    |
| `notifications` | 🔒    | `recipient_user_id` or `customer_id`, `channel`, `template`, `status`, `sent_at` (BOS-070)                                                                      |

- **Journal entries must balance.** A deferred constraint trigger checks that `sum(debit_minor) = sum(credit_minor)` per `entry_id`.
- **Journal entries are immutable.** A correction is a new entry with `reverses_entry_id` set (BOS-062).

## 5. Optical extension (vertical)

The optical vertical adds its own tables and points **into** core tables. Core tables never point back. This is the "vertical → core only" rule.

```mermaid
erDiagram
    customers ||--o{ prescriptions : has
    customers ||--o{ eye_exams : has
    eye_exams ||--o| prescriptions : produces
    orders ||--o| order_prescriptions : "extended by"
    prescriptions ||--o{ order_prescriptions : "copied into"

    prescriptions {
        uuid id PK
        uuid tenant_id FK
        uuid customer_id FK
        uuid exam_id FK
        date issued_on
        date expires_on
        numeric od_sph "right eye; 0.25 steps"
        numeric od_cyl
        int od_axis "0 to 180"
        numeric od_add
        numeric os_sph "left eye"
        numeric os_cyl
        int os_axis
        numeric os_add
        numeric pd_distance
        numeric pd_near
        jsonb prism "rarely used, kept flexible"
        text examiner
        text notes
    }
    order_prescriptions {
        uuid order_id PK "1:1 with orders"
        uuid tenant_id FK
        uuid prescription_id FK "where it came from"
        jsonb rx_snapshot "values copied at order time"
        jsonb lens_job "lens type, index, coatings, fitting heights, frame measurements"
    }
    eye_exams {
        uuid id PK
        uuid tenant_id FK
        uuid customer_id FK
        date exam_date
        jsonb findings "VA, IOP, notes"
        uuid order_line_id FK "exam fee charged, if any"
    }
```

## 6. Walk-through: one optical order end to end

This is the scenario from the product brief: frame + lenses + anti-reflective coating, RM900 total, RM300 deposit.

| Step                                               | What happens                                                                                       | Tables written                                                                               |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1. Customer arrives                                | Found or created                                                                                   | `customers`                                                                                  |
| 2. Eye exam                                        | Exam recorded and an Rx produced                                                                   | `eye_exams`, `prescriptions`                                                                 |
| 3. Order created                                   | Number allocated; the tenant's `optical_job` workflow is attached                                  | `document_sequences`, `orders` (status `created`), `order_status_history`                    |
| 4. Items added                                     | Frame RM450, lens RM350, AR coating RM100, with prices and tax copied onto the lines               | `order_lines`                                                                                |
| 5. Rx attached                                     | Rx values copied plus lens job details                                                             | `order_prescriptions`                                                                        |
| 6. Deposit RM300                                   | Payment row; `paid_minor = 30000`, `balance_minor = 60000`; journal Dr Cash / Cr Customer deposits | `payments`, `orders`, `journal_entries`, `journal_lines`, `outbox_events` (PaymentReceived)  |
| 7. Frame reserved                                  | Reservation held against the frame variant                                                         | `stock_reservations`, `stock_levels.reserved`, `order_status_history`                        |
| 8. Lens ordered → received → assembly → QC → ready | Each status change is recorded; Ready emits an event                                               | `orders.status`, `order_status_history`, `outbox_events`                                     |
| 9. Customer notified                               | "Your glasses are ready"                                                                           | `notifications`                                                                              |
| 10. Pickup, balance RM600                          | Second payment; balance 0                                                                          | `payments`, `journal_*`                                                                      |
| 11. Completed                                      | `OrderCompleted` → reservation consumed, stock deducted, revenue/COGS/SST posted                   | `stock_reservations`, `stock_movements` (sale), `stock_levels`, `journal_*`, `outbox_events` |

Every hop has a table and a foreign key, and none of the core tables hold optical columns.

## 7. Open questions

These need a decision before or during the ticket named.

1. **Deposit accounting (BOS-062):** post deposits to a _Customer deposits_ liability and recognise revenue at completion (recommended, matches "sale happens at pickup"), or recognise revenue when the order is created?
2. **Primary key generation:** decided in BOS-010: `gen_random_uuid()` (v4, built in). UUIDv7 can still be adopted later without a schema change.
3. **Cross-tenant FK safety:** decided in BOS-010: composite foreign keys `(tenant_id, x_id) → (tenant_id, id)`. `createTenantTable()` adds the `unique (tenant_id, id)` they need to every tenant table.
4. **`users.email` case:** `citext` extension or lower-cased unique index? (The draft assumes `citext`.)
5. **Prescription storage:** typed columns per eye (drafted) vs. one `jsonb`. Typed columns validate better and are easier to report on. Revisit if contact-lens Rx needs very different fields.
6. **Multi-currency:** one currency per tenant for now (`tenants.currency`). Add a currency column to money tables only if a tenant ever needs mixed currencies.
