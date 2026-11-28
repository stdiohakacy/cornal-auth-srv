# Architecture rules — cornal-auth-srv

Sources: `../CORNAL_AUTH_ARCHITECTURE_PLAYBOOK.md`, `../CORNAL_AUTH_SYSTEM_DESIGN.md`, `docs/superpowers/plans/2026-11-26-cornal-auth-roadmap.md`.

## Layout
- Modules live in `src/modules/<m>/{domain,application,infrastructure,presentation}` + `<m>.module.ts`.
- Modules: identity, federation, mfa, session, organization, access-control, revocation, security, audit.
- Shared kernel: `src/shared/{domain,application,infrastructure}`. Contracts (Zod + error codes): `src/contracts/`.
- Roles: one image, `APP_ROLE = login | api | worker`, composed in `AppModule.forRole()`. `src/agent/` is the DB-less authz-agent; `src/sdk/` stays Nest-free.

## Layers
- domain/: pure TS. Imports only src/shared/domain/* and src/contracts/error-codes.ts. NO @nestjs, typeorm, node:async_hooks, process.env.
- application/: use cases + ports. NO @nestjs/*, NO typeorm. Wired in <m>-core.module.ts with `provideClass(Cls, [TOKEN, from(APP_CONFIG, c => c.X), fixed(v)], PORT?)` (shared/infrastructure/di) + Symbol tokens; hand-written useFactory only for adapters built from object literals.
- infrastructure/: TypeORM records, mappers, repositories, crypto/jose/Redis adapters. Only layer that touches I/O.
- presentation/: controllers/guards. Call use cases only; never repositories or aggregates.
- OpenAPI: request bodies/params come from `@Body({ schema })`/`@Param(..., { schema })`; add `@ApiResult(ResponseSchema)` for 2xx bodies and `@ApiErrors(...codes)` for the use case's error union (status from ERROR_STATUS). Security and guard errors are derived from the guard map in `src/openapi/app-openapi.ts`: a new guard gets an entry there. Never `z.custom()` in contracts (cannot become JSON Schema).
- Cross-module: depend on another module's exported use case (façade) adapted to your own port in <m>-core.module.ts, or consume its outbox topic. Never read another module's tables. NEVER forwardRef.

## ESM & TypeScript
- Imports end in .js. Inside a module use relative paths; anything reached via `../../` or further uses `#src/...`. No barrel index.ts. No require(), no __dirname (use import.meta.dirname).
- No `any`, no `!`, no `as` except at trusted boundaries (DB row → branded id). Use invariant()/first()/single().
- `verbatimModuleSyntax` is on: pure types use `import type`; classes injected by constructor stay value imports (DI metadata).
- Ports use Symbol tokens whose names differ from the type (USER_REPOSITORY / UserRepository).
- Unions via `as const` objects or literal unions; no TS enum. Prefer `type` for data, `interface` for ports.
- Durations are milliseconds built with `shared/domain/duration.ts` (`minutes(15)`, `days(7)`, `toEpochSeconds`, `secondsUntil`); no raw `* 1000` / `60 * 60` math. Seconds only at edges (JWT, cookies, env).
- Tunable security policy (TTLs, lockout, rotation limits) lives in `<m>/domain/<m>-policy.ts` as an `as const` object (IDENTITY_POLICY, SESSION_POLICY): code, not env, so changes are reviewed. Deployment settings (URLs, lifetimes ops may tune) stay in APP_CONFIG.

## Domain modelling
- Aggregates: private ctor + static create/register (raises events) + static reconstitute (no events). State changes only via named methods.
- Events: plain data from createEvent(); type = '<module>.<aggregate>.<past_tense>'. Never class-based, never constructor.name.
- Expected failures → return err(new XxxError()) with a stable code from contracts/error-codes.ts. Bugs/infra → throw.
- IDs: branded, newId() = crypto.randomUUIDv7().

## Persistence & transactions
- Every write inside uow.run(); returning err() rolls back. Repositories: optimistic UPDATE ... WHERE version, then markPersisted() + track().
- Side effects after commit only via @nestjs/outbox (stable consumer names; processInTransaction for DB writes).
- An event reaches the outbox only if its topic is registered in OutboxTopics (module onModuleInit). Adding a consumer = register its topic; unhandled keyed messages block their aggregate's queue.
- Raw secrets (tokens, codes) never enter the outbox: emit an event, let the worker mint the secret and send it.
- Slow work (Argon2, HTTP calls) outside uow.run(). Login order: rate limit → HashAdmissionGate → Argon2 → short tx.
- Migrations only; synchronize: false. Explicit column types. Relation<T> for circular relations.
- Runtime DB traffic via PgBouncer (DATABASE_URL); no session-level features (LISTEN, SET, advisory locks) through it.

## Auth specifics
- Passwords: node:crypto argon2id (m=19456, t=2, p=1) via PasswordHasher port. Never log, never return hashes.
- Access JWT ES256 via jose (typ at+jwt, kid), TTL 600s, unique jti, claims sub/sid/uv/amr/auth_time (+ org claims in Phase 5). Refresh = opaque `<sid>.<secret>`, sha256 stored, rotate + reuse detection.
- Refresh cookie `cornal_rt` HttpOnly/Secure/SameSite=Strict/Path=/auth (set and clear with the same attributes); mobile uses `X-Client-Type: mobile` + body.
- Errors repositories throw and use cases catch (e.g. ConcurrencyConflictError) live in shared/domain, never in infrastructure.
- Revocation is version-based (user/session/membership/org), never timestamp-based.
- Same error for unknown email and wrong password. Lockout lives in the User aggregate.
- Every org-scoped route checks token `org` === route `:orgId`.

## Dependencies
- Node built-ins first (crypto, AsyncLocalStorage, process.loadEnvFile), then first-party @nestjs/*, then others.
- Every new package must satisfy pnpm minimumReleaseAge (14 days). Never add it to minimumReleaseAgeExclude without asking.
- Forbidden: uuid, lodash, moment, dotenv, bcrypt*, passport*, jsonwebtoken, cls-hooked, class-validator, @nestjs/cqrs.

## Tests (Vitest projects)
- unit: src/**/*.spec.ts — no Nest, no DB, no vi.mock of modules. Fakes via in-memory repos + kept vi.fn() handles.
- integration: test/integration/*.int-spec.ts — real Postgres/Redis (docker compose). e2e: test/e2e/*.e2e-spec.ts — AppModule.forRole + supertest.
- Every bug fix ships with a failing-first test at the lowest tier that reproduces it.
