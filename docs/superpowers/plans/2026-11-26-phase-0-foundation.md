# Phase 0 — Foundation & Tooling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare the repo with strict tooling, a three-project test setup, a Zod-validated config that fails fast, an `APP_ROLE`-driven bootstrap with a health endpoint, local infrastructure via docker-compose, CI, and architecture rules for agents.

**Architecture:**
- `src/config/` parses `process.env` once into a frozen `AppConfig`.
- `main.ts` loads `.env` with Node's built-in `process.loadEnvFile`, parses the config (prints readable issues and exits 1 on failure), then boots `AppModule.forRole(config)`.
- Every role exposes `GET /health`.
- The sample `AppController` and `AppService` are deleted.

**Tech Stack:** Node 24.16, NestJS 12, TypeScript 6.0.3, oxlint 1.95 (type-aware), Vitest 4.1, `zod@4.6.7`, Docker Compose (PostgreSQL 17, PgBouncer, Redis 7, NATS 2 JetStream), GitHub Actions.

**Spec:** `2026-11-26-cornal-auth-roadmap.md` → Phase 0; `CORNAL_AUTH_ARCHITECTURE_PLAYBOOK.md` §4.2, §6; `CORNAL_AUTH_SYSTEM_DESIGN.md` §3.1.

## Global Constraints

- ESM: relative imports end in `.js`. No barrels, no `__dirname`, no `dotenv`.
- No `any`, no `!`. Only `zod` gets added in this phase (it already passes `minimumReleaseAge`).
- **No commits.** The user's rule is: never commit unless asked. Commit steps are replaced by a verification gate at the end.
- **Deviation from the roadmap:** the JWT, Redis-client and NATS-client variables are added in the phase that first uses them (YAGNI). Phase 0 only declares the infrastructure URLs that compose provides.

## Review Focus

1. **Env with `PORT=abc` or no `DATABASE_URL`:** startup prints every issue and exits with code 1, **without** a stack trace. Owner: Task 4.
2. **`APP_ROLE` with an unknown value:** rejected by the schema, with the valid values listed. Owner: Task 4.
3. **A missing `.env` file in production:** no crash, because the config is read from the real env. Owner: Task 5.
4. **`verbatimModuleSyntax` + DI:** a class injected through a type-only import breaks DI. The `/health` e2e test boots real Nest DI. Owner: Task 5.
5. **Lint rule set too strict for test files:** for example `unbound-method` on `vi.fn()`. The whole suite must lint clean. Owner: Task 2.

---

### Task 1: Tighten tsconfig

**Files:**
- Modify: `tsconfig.json`

- [ ] Add `"verbatimModuleSyntax": true`, `"noImplicitOverride": true`, `"exactOptionalPropertyTypes": true` under `compilerOptions`.
- [ ] Run `pnpm exec tsc --noEmit`. Expected: errors only in the sample files that import types as values (e.g. `TestingModule`, `INestApplication`). Task 5 replaces those files.

### Task 2: oxlint rule set

**Files:**
- Modify: `.oxlintrc.json`

**Interfaces:** Produces the rule set every later phase is linted against.

- [ ] Set the plugins `typescript`, `import`, `vitest`, `oxc`, `eslint`, `unicorn`.
- [ ] Set these rules to `error`:
  - `typescript/no-explicit-any`, `typescript/no-non-null-assertion`, `typescript/no-floating-promises`
  - `typescript/consistent-type-imports`, `typescript/only-throw-error`
  - `typescript/return-await` (`in-try-catch`)
  - `import/no-cycle`
- [ ] Override for `src/**/domain/**` and `src/**/application/**`: `no-restricted-imports` with patterns `@nestjs/*`, `typeorm`, `@nestjs/typeorm`, `**/infrastructure/**`, and the message "Domain/application must stay framework-free."
- [ ] Run `pnpm lint`. Expected: 0 errors once Task 5 has run. Re-run it at the gate.

### Task 3: Vitest projects + scripts

**Files:**
- Modify: `vitest.config.ts`, `package.json`
- Delete: `vitest.config.e2e.ts`

- [ ] `vitest.config.ts`: shared `resolve.tsconfigPaths: true`, `test.globals: true`, and `test.projects`:
  - `{ name: 'unit', include: ['src/**/*.spec.ts'] }`
  - `{ name: 'integration', include: ['test/integration/**/*.int-spec.ts'], fileParallelism: false }`
  - `{ name: 'e2e', include: ['test/e2e/**/*.e2e-spec.ts'], fileParallelism: false }`
  - Each project uses `extends: true`.
- [ ] Scripts:
  - `test` → `vitest run --project unit`
  - `test:int` → `vitest run --project integration --passWithNoTests`
  - `test:e2e` → `vitest run --project e2e`
  - `test:all` → `vitest run`
  - `test:watch` → `vitest --project unit`
- [ ] Run `pnpm test`. Expected: the existing unit spec still runs (removed in Task 5).

### Task 4: Typed config (Zod 4, fail fast)

**Files:**
- Create: `src/config/env.schema.ts`, `src/config/config.module.ts`
- Test: `src/config/env.schema.spec.ts`

**Interfaces:**
- Produces:
  - `EnvSchema` (Zod object).
  - `type AppConfig = Readonly<z.infer<typeof EnvSchema>>`.
  - `const APP_CONFIG: unique symbol`.
  - `type AppRole = AppConfig['APP_ROLE']`.
  - `function parseConfig(env: Record<string, string | undefined>): Result<AppConfig, string>`. On failure the string is `z.prettifyError` output.
  - `class ConfigModule { static forRoot(config: AppConfig): DynamicModule }`: global, exports `APP_CONFIG`.

**Schema fields:**

| Field | Type / default |
|---|---|
| `NODE_ENV` | enum `development \| test \| production`, default `development` |
| `APP_ROLE` | enum `login \| api \| worker`, default `api` |
| `PORT` | coerce int 1–65535, default `3001` |
| `LOG_LEVEL` | enum `fatal error warn info debug trace`, default `info` |
| `DATABASE_URL` | `z.url()` (through PgBouncer) |
| `DATABASE_DIRECT_URL` | `z.url()` (migrations, session features) |
| `DATABASE_REPLICA_URL` | `z.url().optional()` |
| `REDIS_URL` | `z.url()` |
| `NATS_URL` | `z.url()` |

- [ ] **Write the failing tests** in `env.schema.spec.ts`:
  - `parses a minimal valid env and applies defaults`: `APP_ROLE` `'api'`, `PORT` `3001`, `NODE_ENV` `'development'`.
  - `coerces PORT from string`: `'8080'` becomes `8080`.
  - `rejects an unknown APP_ROLE and lists the allowed values`: the error string contains `APP_ROLE` and `login`.
  - `reports every missing required variable at once`: the env is `{}`, and the error contains `DATABASE_URL`, `REDIS_URL` and `NATS_URL`.
  - `returns a frozen object`: `Object.isFrozen(result.value)` is true.
- [ ] Run `pnpm test src/config`. Expected: FAIL (module not found).
- [ ] `pnpm add zod@4.6.7`. Implement `env.schema.ts` and `config.module.ts`. Return a `Result`-shaped `{ ok, value } | { ok: false, error }` locally, because the shared `Result` arrives in Phase 1. Phase 1 swaps the import.
- [ ] Run `pnpm test src/config`. Expected: PASS (5 tests).

### Task 5: Role-based bootstrap + health endpoint; remove samples

**Files:**
- Create: `src/health/health.controller.ts`, `test/e2e/health.e2e-spec.ts`
- Modify: `src/app.module.ts`, `src/main.ts`
- Delete: `src/app.controller.ts`, `src/app.service.ts`, `src/app.controller.spec.ts`, `test/app.e2e-spec.ts`

**Interfaces:**
- Consumes: `AppConfig`, `APP_CONFIG`, `ConfigModule.forRoot`, `parseConfig` (Task 4).
- Produces:
  - `AppModule.forRole(config: AppConfig): DynamicModule`. Later phases add role-specific imports inside it, using a `switch` on `config.APP_ROLE` with `assertNever`.
  - `GET /health` → `200 { status: 'ok', role: AppRole }`.

- [ ] **Write the failing e2e test** `health.e2e-spec.ts`: build `AppModule.forRole(config)` from a fixed `AppConfig` (role `'login'`), then `GET /health` → 200 `{ status: 'ok', role: 'login' }`.
- [ ] Run `pnpm test:e2e`. Expected: FAIL.
- [ ] Implement `HealthController`, which injects `APP_CONFIG` via `@Inject(APP_CONFIG)`, and `AppModule.forRole`.
- [ ] `main.ts` steps, in order:
  1. If `existsSync('.env')`, call `process.loadEnvFile('.env')`.
  2. Call `parseConfig(process.env)`. On error, write `Invalid environment configuration:\n${error}` to stderr, set `process.exitCode = 1`, and return.
  3. `NestFactory.create(AppModule.forRole(config))`.
  4. `enableShutdownHooks()`.
  5. `listen(config.PORT)`.
- [ ] Delete the sample files. Run `pnpm test:e2e` and `pnpm test`. Expected: PASS.
- [ ] Manual check: running `PORT=abc node dist/main.js` after `pnpm build` prints the issues, has **no stack trace**, and exits with code 1.

### Task 6: Local infrastructure (docker-compose) + `.env.example`

**Files:**
- Create: `docker-compose.yml`
- Modify: `.env.example`

**Services:**

| Service | Image / settings |
|---|---|
| `postgres` | `postgres:17-alpine`; user/password/db `cornal_auth`; port 5432; healthcheck `pg_isready`; named volume |
| `pgbouncer` | `edoburu/pgbouncer`; `POOL_MODE=transaction`, `AUTH_TYPE=scram-sha-256`, `DEFAULT_POOL_SIZE=20`, `MAX_CLIENT_CONN=500`; port 6432; `depends_on` postgres healthy |
| `redis` | `redis:7-alpine`; port 6379; healthcheck `redis-cli ping` |
| `nats` | `nats:2-alpine` with `-js -m 8222`; ports 4222 and 8222; healthcheck on `/healthz` |

- [ ] `.env.example` lists every `EnvSchema` field with values matching compose: `DATABASE_URL` → pgbouncer on 6432, `DATABASE_DIRECT_URL` → postgres on 5432.
- [ ] Run `docker compose config -q`. Expected: exit code 0. If the Docker daemon is running, also run `docker compose up -d --wait` and expect all 4 services healthy. Otherwise record the check as pending.
- [ ] Run `parseConfig` against `.env.example`, covered by an extra unit test `.env.example satisfies the schema` that reads the file with `node:util` `parseEnv`. Expected: PASS.

### Task 7: CI pipeline

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] Trigger on push and PR.
- [ ] Job `checks`:
  1. `actions/checkout`
  2. `pnpm/action-setup` (version from `packageManager`, or 10)
  3. `actions/setup-node` with `node-version-file: .nvmrc` and `cache: pnpm`
  4. `pnpm install --frozen-lockfile`
  5. `pnpm lint`
  6. `pnpm exec tsc --noEmit`
  7. `pnpm test`
  8. `pnpm test:e2e`
- [ ] Job `integration` (needs `checks`): services `postgres:17-alpine` and `redis:7-alpine` with health options, then `pnpm test:int`.
- [ ] Check the YAML parses with `node -e` and `yaml`, if available. Otherwise review it by eye.

### Task 8: Architecture rules for agents

**Files:**
- Create: `.claude/rules/architecture.md` (content from PB§6, adapted to the final module list in SD§3.1)
- Modify: `CLAUDE.md`. Add `@.claude/rules/architecture.md`, the new commands (`test:int`, `test:all`, `docker compose up -d --wait`) and `APP_ROLE`. Keep it under 100 lines.

- [ ] Run `wc -l CLAUDE.md`. Expected: under 100.

### Gate (instead of a commit)

- [ ] `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm test:e2e && pnpm build` all pass.
- [ ] Report the result to the user, list the changed files, and wait for the commit request.
