# Phase 2 — Persistence, Unit of Work & Outbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the app a migrated PostgreSQL schema, a TypeORM connection through PgBouncer, a hand-written Unit of Work and a transactional outbox, all proven against a real database.

**Architecture:**
- **UoW (user decision: hand-written).** `TransactionContext` keeps the active `EntityManager` and the aggregates that changed in native ALS. `TypeOrmUnitOfWork.run()`:
  1. Wraps `dataSource.transaction`.
  2. Rolls back when the work returns `err()`.
  3. Joins an outer transaction if one is already open.
  4. Pulls every tracked aggregate's events and passes them to `outbox.add(manager, …)` **before** COMMIT.
  5. Calls `notify()` after commit.
- **Migrations.** These are plain TypeORM migration classes run by our own script on `DATABASE_DIRECT_URL` (never through PgBouncer). The `@nestjs/outbox` schema comes from `PostgresOutboxStore.migrationSql()` inside migration 0002, and the store runs with `migrate: false`. That leaves one migration path.

**Tech Stack:**
- `typeorm@1.1.2` (`1.1.3` fails the 14-day rule), `@nestjs/typeorm@12.0.3`, `pg@8.23.1`, `@nestjs/outbox@0.1.4` (+ `@nestjs/store-kit@0.1.3`). All of these are installed and passed the release-age check.
- PostgreSQL 17.12 with READ COMMITTED (verified), PgBouncer in transaction mode (verified healthy).

**Spec:**
- `2026-11-26-cornal-auth-roadmap.md`, Phase 2.
- `CORNAL_AUTH_ARCHITECTURE_PLAYBOOK.md` §3 (UoW draft, outbox).
- `CORNAL_AUTH_SYSTEM_DESIGN.md` §2.2 (DDL, already executed cleanly on PG 17.12: 18 tables) and §2.3–2.4 (rotation `UPDATE`, PgBouncer rules).

## Global Constraints

- Same as Phases 0–1: ESM, no `any` or `!`, every dependency at least 14 days old, **no commits**.
- Runtime traffic uses `DATABASE_URL` (PgBouncer, pool `max: 5`). Migrations use `DATABASE_DIRECT_URL`. Never use session features (LISTEN, SET, advisory locks) through PgBouncer.
- `synchronize: false` always. Entities are registered explicitly or through `forFeature` with `autoLoadEntities`; never scanned by glob.
- `RollbackSignal` must be a class extending `Error`, because oxlint enforces `only-throw-error`.
- Integration tests use the database `cornal_auth_test`, which global setup recreates on every run.

## Review Focus

1. **Use case returns `err()` after writing rows** → nothing committed and **no outbox row**; the caller still receives the same `err` object. Owner: Task 3.
2. **Nested `uow.run()`** (a façade called inside another use case) → one transaction. An outer rollback undoes the inner writes. Owner: Task 3.
3. **Two concurrent saves of the same aggregate version** → exactly one wins, the other throws `ConcurrencyConflictError` (maps to 409). Owner: Task 3.
4. **Repository write outside `uow.run()`** → `InvariantViolation`, so the write never autocommits silently. Owner: Task 3.
5. **Audit insert in the current month** (2026-11) → lands in a real partition, not `audit_logs_default`. The design DDL only created 2026-12 and 2027-01. Owner: Task 1.

---

### Task 1: Migrations 0001 (schema) + 0002 (outbox), migrate script, test database

**Files:**
- Create:
  - `src/database/migrations/0001-init.migration.ts`: the SD §2.2 DDL verbatim, plus the cross-tenant trigger, plus a `DO` block that creates audit partitions for the current month and the next 2. The fixed 2026-12 and 2027-01 partitions are removed.
  - `src/database/migrations/0002-outbox.migration.ts`: `up` = `PostgresOutboxStore.migrationSql()`, `down` = `DROP SCHEMA nest_outbox CASCADE`.
  - `src/database/migrations.ts`: `export const MIGRATIONS = [Init0001, Outbox0002]`. This is an ordered list, not a barrel.
  - `src/database/data-source-options.ts`
  - `src/database/migrate.ts`: a CLI that runs `up` and supports `--revert` to undo the last migration.
  - `test/integration/support/global-setup.ts`
  - `test/integration/support/test-db.ts`
- Modify: `vitest.config.ts` (integration `globalSetup`), `package.json` (scripts `db:migrate`, `db:revert`)
- Test: `test/integration/schema.int-spec.ts`

**Interfaces:**
- `buildDataSourceOptions(url: string, extra?: { entities?: Function[] }): DataSourceOptions` returns postgres, `synchronize: false`, `migrations: MIGRATIONS`, `migrationsTableName: 'typeorm_migrations'`, `extra: { max: 5 }`.
- `TEST_DATABASE_URL`: defaults to `postgres://cornal_auth:cornal_auth@localhost:5432/cornal_auth_test` and can be overridden by env.
- `createTestDataSource(): Promise<DataSource>`: initialised against the test database.
- Trigger `membership_roles_same_tenant` (`BEFORE INSERT OR UPDATE`): raises `check_violation` when `roles.org_id IS NOT NULL AND roles.org_id <> memberships.org_id`.

- [ ] **Failing tests** in `schema.int-spec.ts`:
  - `creates every core table`: `users`, `password_credentials`, `identities`, `one_time_tokens`, `mfa_factors`, `mfa_recovery_codes`, `organizations`, `memberships`, `permissions`, `roles`, `role_permissions`, `membership_roles`, `sessions`, `revocation_events`, `audit_logs`, `nest_outbox.messages`.
  - `audit row for now() lands in a monthly partition, not default`
  - `rejects assigning another tenant's custom role` (expects SQLSTATE `23514`)
  - `allows assigning a system role (org_id NULL)`
  - `reverting every migration leaves no app tables, re-running restores them`
- [ ] Run `pnpm test:int`. Expected: FAIL.
- [ ] Implement. Global setup:
  1. Connect to the `postgres` database with the same credentials.
  2. `DROP DATABASE IF EXISTS cornal_auth_test WITH (FORCE)`, then `CREATE`.
  3. Run `MIGRATIONS`.
- [ ] Run `pnpm test:int`. Expected: PASS. Also run `pnpm build && pnpm db:migrate` against the dev database. Expected: 2 migrations applied, and a second run applies 0.

### Task 2: `PersistenceModule` (TypeORM + outbox store + readiness probe)

**Files:**
- Create: `src/shared/infrastructure/persistence/persistence.module.ts`
- Modify:
  - `src/config/env.schema.ts`: add `OUTBOX_RELAY_ENABLED` (string `'true'`/`'false'` → boolean, default `true`) and `DB_POOL_MAX` (coerced int 1–50, default 5).
  - `.env.example`
  - `src/app.module.ts`: add `PersistenceModule` for every role.
  - `test/e2e/support/create-app.ts`: point the default config at the test DB through PgBouncer is not available for the test DB, so use the direct test URL, and set `OUTBOX_RELAY_ENABLED: false`.
  - `test/e2e/health.e2e-spec.ts`: rename the manually registered probes to `fake-*`, because `postgres` is now registered for real.
  - `.github/workflows/ci.yml`: run e2e in the `integration` job, which has services.
- Test: `test/e2e/health.e2e-spec.ts` (new case), `src/config/env.schema.spec.ts` (new cases)

**Interfaces:**
- `PersistenceModule` (global) provides and exports `TransactionContext` and `UNIT_OF_WORK` (implemented in Task 3).
  - Imports `TypeOrmModule.forRootAsync` (`url: DATABASE_URL`, `autoLoadEntities: true`, `extra.max: DB_POOL_MAX`, `retryAttempts: 3`).
  - Imports `OutboxModule.forRootAsync` (`relay: { enabled: OUTBOX_RELAY_ENABLED, pollInterval: '250ms' }`).
  - Provides `PostgresOutboxStore` via a factory: `fromTypeOrm(dataSource)`, `migrate: false`.
  - On init, registers the readiness probe `postgres` → `SELECT 1`.

- [ ] **Failing tests:**
  - env: `OUTBOX_RELAY_ENABLED "false" becomes false`, `DB_POOL_MAX defaults to 5`.
  - e2e: `readiness reports postgres up from the real database`, meaning `GET /health/ready` → 200 with `info.postgres.status === 'up'`.
- [ ] Run, expect FAIL → implement → run `pnpm test`, `pnpm test:e2e` and `pnpm test:int`. Expected: PASS.

### Task 3: `TransactionContext` + `TypeOrmUnitOfWork` + `ConcurrencyConflictError` + pg error helper

**Files:**
- Create:
  - `src/shared/infrastructure/persistence/transaction-context.ts` (Playbook §3.3)
  - `src/shared/infrastructure/persistence/typeorm-unit-of-work.ts` (Playbook §3.3, with `RollbackSignal extends Error`)
  - `src/shared/infrastructure/persistence/concurrency-conflict.error.ts`: `ConcurrencyConflictError extends DomainError<'COMMON.CONCURRENCY_CONFLICT'>`, thrown by repositories and mapped to 409 by the existing filter.
  - `src/shared/infrastructure/persistence/pg-errors.ts`: `isUniqueViolation(error: unknown, constraint?: string): boolean`, which checks SQLSTATE `23505` on `QueryFailedError.driverError`.
- Test:
  - `test/integration/unit-of-work.int-spec.ts`, which uses a test-only `Counter` aggregate plus a repository over the table `it_counters(id uuid pk, value int, version int)` created in `beforeAll`.
  - `test/integration/pg-errors.int-spec.ts`

**Interfaces:**
- `TransactionContext`: `run(manager, fn)`, `active`, `requireManager()`, `track(aggregate: EventSource)`.
- `TypeOrmUnitOfWork implements UnitOfWork`. Outbox messages have the shape `{ id: event.id, topic: event.type, key: event.aggregateId, payload: event, headers: { 'x-request-id'?, 'x-actor-id'? } }`.

- [ ] **Failing tests** in `unit-of-work.int-spec.ts`:
  - `commits rows and writes one outbox message per event when work returns ok`: assert 1 row in `it_counters` and 1 row in `nest_outbox.messages` with `topic = 'test.counter.incremented'`.
  - `returns the same err and commits nothing when work returns err` (Review Focus #1)
  - `rolls back and rethrows when work throws`
  - `nested run joins the outer transaction` (Review Focus #2: an outer `err` undoes the inner write)
  - `concurrent saves of the same version: one ConcurrencyConflictError` (Review Focus #3)
  - `write outside run throws InvariantViolation` (Review Focus #4)
  - `outbox headers carry the request id when inside a request context`
- [ ] **Failing tests** in `pg-errors.int-spec.ts`:
  - `isUniqueViolation true for duplicate key, matching constraint name`
  - `false for other errors`
- [ ] Run `pnpm test:int`. Expected: FAIL.
- [ ] Implement, and bind `UNIT_OF_WORK` → `TypeOrmUnitOfWork` in `PersistenceModule`.
- [ ] Run `pnpm test:int`. Expected: PASS.

### Task 4: Docs + gate

- [ ] `CLAUDE.md`: document `pnpm db:migrate` / `pnpm db:revert`, and note that e2e and integration tests need `docker compose up -d --wait`.
- [ ] Mark Phase 0–2 progress in the roadmap with checkboxes ticked for completed phases.
- [ ] Gate: `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm test:e2e && pnpm test:int && pnpm build` → exit 0.
- [ ] Report to the user and wait for their commit.

**Deferred:** a read-replica DataSource (`DATABASE_REPLICA_URL`) arrives with its first reader (Phase 4 device list), so it is not added in this phase.
