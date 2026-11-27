# cornal-auth-srv — Implementation Roadmap (Master Checklist)

> **For agentic workers:** This is a master roadmap, not a bite-sized plan. Each phase below becomes its own plan file (`docs/superpowers/plans/YYYY-MM-DD-phase-N-<name>.md`) written with superpowers:writing-plans when that phase starts, then executed with superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `cornal-auth-srv` as the centralized multi-tenant IAM described in the design: email/password + Google login, TOTP MFA, refresh rotation with reuse detection, multi-org RBAC, revocation in under 5s, and audit logging. Verification runs off the hot path through `authz-agent`.

**Architecture:** One NestJS 12 ESM image runs as three roles (`login` | `api` | `worker`), plus a DB-less `authz-agent` sidecar behind Envoy `ext_authz`. Each module follows the hexagonal layout (domain / application / infrastructure / presentation). Writes go through `UnitOfWork`, and side effects after commit go through `@nestjs/outbox`.

**Tech Stack:** Node 24, NestJS 12, TypeScript 6 strict, TypeORM + PostgreSQL 17, PgBouncer, Redis 7, NATS JetStream, `jose`, `zod@4`, Vitest 4, oxlint `--type-aware`, Envoy.

**Spec:**
- `../../../../CORNAL_AUTH_SYSTEM_DESIGN.md`. Section references below are written as `SD§n`.
- `../../../../CORNAL_AUTH_ARCHITECTURE_PLAYBOOK.md`. Section references are written as `PB§n`.
- Verified reference code lives in both docs. Copy it, don't rewrite it.

## Global Constraints

Copied from the spec.

**Language and imports**
- Use Pure ESM. Relative imports end in `.js`. No barrel `index.ts`, no `require`, no `__dirname`.
- Write strict TypeScript with `noUncheckedIndexedAccess`. No `any`, no `!`. Casts are allowed only at trusted boundaries.

**Layering and dependency injection**
- `domain/` and `application/` must not import `@nestjs/*` or `typeorm`.
- Ports use Symbol tokens. A token's name is different from its type's name (`USER_REPOSITORY` / `UserRepository`).

**Domain model and persistence**
- IDs come from `crypto.randomUUIDv7()`. Passwords are hashed with `crypto.argon2` argon2id, m=19456, t=2, p=1, tagLength=32, stored as a PHC string.
- Expected failures return `err(DomainError)` with a string `code`. Bugs are thrown. The HTTP mapping lives in a single `satisfies Record<ErrorCode, HttpStatus>` table.
- Every DB write happens inside `uow.run()`. Optimistic locking uses `UPDATE … WHERE version = n`. Argon2 runs outside the transaction.

**Tokens**
- Access token: ES256, TTL **600s**. Claims: `iss aud sub sid jti iat exp auth_time amr org mid uv mv ov pcv pbits`.
- Refresh token: opaque `<sid>.<base64url(32B)>`. Store only its sha256. Keep `prev_refresh_hashes` up to **5**. Grace window is **10s**.
- Revocation entry TTL = access TTL + 60s skew (**11 min**). Outbox relay `pollInterval: '250ms'`. Agent `XREAD` every **1s**, PG snapshot fallback every **2s**. Fail-closed when the feed is stale for more than **30s** on sensitive routes.
- Lockout after **5** failures for **15 min**. TOTP: 6 digits, 30s step, ±1 step tolerance, **10** recovery codes. MFA challenge TTL **5 min**, **5** attempts.
- One-time tokens: sha256 hash, single use, password reset TTL **30 min**.

**Dependencies, tests and git**
- Forbidden dependencies: `uuid lodash moment dotenv bcrypt* passport* jsonwebtoken cls-hooked class-validator @nestjs/cqrs`. Every dependency must pass pnpm `minimumReleaseAge` (14 days).
- Test tiers: domain and application `*.spec.ts` without Nest or a DB; `test/integration/*.int-spec.ts` against real Postgres; `test/e2e/*.e2e-spec.ts` against the full app.
- No commit or push without the user's approval.

## Review Focus

Each item below must get a test in the phase that owns it.

1. **Two concurrent refreshes with the same token** → exactly 1 succeeds, the other gets 409, and the session is not revoked (grace). Owner: Phase 4.
2. **A token that holds the correct `sid` but a wrong secret** (not in the current or previous hashes) → 401 only, **no** revoke. Prevents a DoS by anyone who only knows the `sid`. Owner: Phase 4.
3. **Cross-tenant:** a token for org A calls a route with `:orgId = B` → 403. Assigning org B's custom role to a membership in org A → domain err plus a trigger rejection. Owner: Phase 5.
4. **Revocation events arriving out of order or duplicated** (old version after new, the same event twice) → the agent keeps the strictest entry. Owner: Phase 6 (the `RevocationMap` tests already exist).
5. **A login burst exceeding the gate** → requests above `maxConcurrent + maxQueued` get 503 with `Retry-After`. Event loop delay p99 stays under 10ms. A nonexistent email takes as long as a wrong password (dummy hash). Owner: Phase 3.

---

## Dependency Graph

```
P0 Foundation ─► P1 Shared kernel ─► P2 Persistence & Outbox ─┬─► P3 Identity ─► P4 Session & Tokens ─┬─► P5 Org & RBAC ─► P6 Revocation ─► P7 authz-agent + SDK
                                                              │                                       ├─► P8 MFA
                                                              │                                       └─► P9 Google OIDC
                                                              └─► P10 Audit (can start right after P2; consumes events from P3+)
P11 Ops / NFR runs alongside from P4 onward; full load tests after P7.
```

**MVP (internal login works):** P0 → P4. **Feature complete:** P0 → P10. **Production ready:** P11.

---

## Phase 0 — Foundation & tooling ✅

> Done — detailed plan: `2026-11-26-phase-0-foundation.md`.

Ref: PB§6, SD§3.1

- [ ] Tighten `tsconfig.json`: add `verbatimModuleSyntax`, `noImplicitOverride`, `exactOptionalPropertyTypes` (verified to be compatible with the shared kernel).
- [ ] Update `.oxlintrc.json` following PB§6:
  - `no-explicit-any: error`, `no-non-null-assertion`, `consistent-type-imports`, `only-throw-error`, `return-await`, `import/no-cycle`.
  - `no-restricted-imports` for `domain/` and `application/`.
  - Check each rule name against the installed oxlint version.
- [ ] `vitest.config.ts` → `test.projects`:
  - `unit`: `src/**/*.spec.ts`
  - `integration`: `test/integration/**/*.int-spec.ts`, `fileParallelism: false`
  - `e2e`
- [ ] Add `docker-compose.yml`: PostgreSQL 17, PgBouncer (transaction mode), Redis 7, NATS JetStream. Add `.env.example` with every variable in `EnvSchema`.
- [ ] Config (PB§4.2):
  - `src/config/env.schema.ts` (Zod 4) and `config.module.ts` exporting `APP_CONFIG`.
  - Start with `node --env-file`, no `dotenv`.
  - Add `APP_ROLE: 'login' | 'api' | 'worker'`, plus the Redis, NATS and JWT key variables.
- [ ] `src/main.ts` + `AppModule.forRole(role)`: build the module set per role (SD§3.1). Delete the sample `AppController` and `AppService`.
- [ ] Wire `pnpm test:int` + a CI pipeline that runs lint → tsc → unit → integration (with compose services).
- [ ] Add architecture rules: `.claude/rules/architecture.md` (PB§6), referenced from `CLAUDE.md`.

**Done when:**
- `pnpm lint && pnpm exec tsc --noEmit && pnpm test` pass.
- `docker compose up` brings up all 4 services as healthy.
- The app starts with `APP_ROLE=api` and fails fast on an invalid env.

## Phase 1 — Shared kernel ✅

> Done — detailed plan: `2026-11-26-phase-1-shared-kernel.md`.

Ref: PB§2, PB§3.3, PB§4.2

- [ ] Copy the verified files into `src/shared/domain/`: `id.ts result.ts domain-error.ts guard.ts value-object.ts entity.ts aggregate-root.ts domain-event.ts watched-list.ts`. Copy their specs too.
- [ ] Copy `src/shared/application/ports.ts` (`RepositoryPort`, `Mapper`, `UNIT_OF_WORK`/`UnitOfWork`, `CLOCK`/`Clock`). Add `SystemClock`.
- [ ] `src/contracts/error-codes.ts`: one shared catalog for `IDENTITY.* SESSION.* ACCESS.* ORG.* MFA.* COMMON.*`. Make the domain errors use it.
- [ ] Request context (PB§3.3): `RequestContext` (native ALS) + `RequestContextMiddleware`. Validate `x-request-id` against `^[\w-]{8,64}$`. Read IP from `X-Forwarded-For` only when the request comes from a trusted proxy.
- [ ] HTTP:
  - `AppExceptionFilter`: a single filter returning RFC 9457 `problem+json` with `code` and `requestId`. Unknown errors become 500 with no message leak.
  - `error-status.ts` using `satisfies`.
  - `unwrap.ts`.
  - Global `StandardSchemaValidationPipe`, fail-closed when a route has no schema.
- [ ] Logger: `nestjs-pino` with `redact` for `password token refreshToken authorization cookie code`.

**Done when:**
- The unit tests for the kernel pass.
- An e2e test of a dummy route that returns an unmapped error shows a `problem+json` body containing `requestId`, and does **not** contain the message.

## Phase 2 — Persistence, Unit of Work & Outbox ✅

> Done — detailed plan: `2026-11-26-phase-2-persistence.md`.

Ref: PB§3, SD§2

- [ ] Install `typeorm @nestjs/typeorm pg @nestjs/outbox` (they must pass the 14-day release age).
- [ ] DataSource:
  - Explicit `entities`, `synchronize: false`, migrations run as a deploy step.
  - Two DataSources: `primary` (through PgBouncer) and `replica`.
  - Pool `max: 5`.
- [ ] Migration `0001_init`: the full DDL from SD§2.2.
  - **Run `psql -f` on PG 17 first** (this DDL has never been executed).
  - Add the cross-tenant trigger on `membership_roles`.
  - Create audit partitions for the current month and the next two.
- [ ] `TransactionContext` + `TypeOrmUnitOfWork`:
  - `ROLLBACK` → `class RollbackSignal extends Error`.
  - Join the outer transaction when one is active.
  - `pullEvents()` → `outbox.add(manager, …)` → `notify()`.
- [ ] `ConcurrencyConflict` (maps to 409) and mapping of PG `23505` unique violations into a domain conflict.
- [ ] `OutboxModule.forRootAsync`:
  - `PostgresOutboxStore` with `fromTypeOrm`.
  - Relay `pollInterval '250ms'`, enabled for the `api`, `login` and `worker` roles.
  - Dead-letter alerting.
- [ ] Integration test harness: one schema per test file, `migrate` → test → drop.

**Done when:** these integration tests pass:
- `uow.run` returning `ok` → rows committed and outbox messages present.
- Returning `err` → no rows and no messages.
- `throw` → rollback.
- Nested `run` → a single transaction.
- Two concurrent updates on the same version → one `ConcurrencyConflict`.

## Phase 3 — Identity: register, verify email, password login, reset ✅

> Done — plans: `2026-11-26-phase-3a-identity.md`, `2026-11-26-phase-3b-password-email.md`. "Change password while logged in" moved to Phase 4 (needs AccessTokenGuard + step-up).

Ref: SD§3.3, SD§3.5, PB§2.4–2.5

- [ ] Domain:
  - `User` (PB§2.4) + `Email` + `identity.errors.ts`.
  - Add `emailVerifiedAt`, `tokenVersion`, `verifyEmail()`, `changePassword()` (bumps `tokenVersion`, raises an event).
- [ ] `Argon2PasswordHasher` (PB, verified) + `DUMMY_ARGON2_HASH` constant computed at boot.
- [ ] Security module:
  - `HashAdmissionGate` (SD§3.3, verified). Set `maxConcurrent = UV_THREADPOOL_SIZE`, `maxQueued = 2 × maxConcurrent`.
  - Run with `UV_THREADPOOL_SIZE` = vCPU in the login deployment.
- [ ] `RedisRateLimiter`: sliding window in Lua, keys `ip`, `email_hash`, `ip+email_hash`. Plus `RateLimitGuard`/`@RateLimit()`. When Redis is down, fall back to a stricter in-process token bucket.
- [ ] Failed-login counter in Redis. Write to PG only on lockout (5 failures / 15 min).
- [ ] Use cases:
  - `RegisterUser` (+ `one_time_tokens(email_verify)` + event) and `VerifyEmail` (atomic consume).
  - `VerifyCredentials` (exported façade for the session module; follow the SD§3.3 order).
  - `RequestPasswordReset` (always returns 202) and `ResetPassword` (revoke all + bump `token_version`).
- [ ] HIBP k-anonymity check (fail-open, 1s timeout) when registering or changing a password.
- [ ] Email sender port + an outbox consumer `email-sender` (log adapter in dev).
- [ ] Controller `/auth/register`, `/auth/verify-email`, `/auth/password/forgot`, `/auth/password/reset`, with Zod schemas in `contracts/`.

**Done when:**
- Unit tests pass for lockout, dummy-hash timing, and the gate shedding load.
- Integration tests pass for register → verify → login credentials, and a reset that revokes sessions.
- A benchmark shows event loop delay p99 under 10ms with 50 concurrent logins.

## Phase 4 — Session & tokens (MVP)

Ref: SD§3.4, SD§4.1, PB§4.3

- [ ] Signing keys:
  - Load PKCS#8 P-256 keys from KMS or a secret, with `kid`.
  - Support the current key and the previous key for rotation.
  - `JoseTokenIssuer` (`SignJWT`) and `/.well-known/jwks.json` (`exportJWK`, `Cache-Control: max-age=300`).
- [ ] `Session` aggregate:
  - Replace `previousRefreshHash` with `prevRefreshHashes` (max 5).
  - Add `amr`, `authTime`, `activeOrgId`, `ip`, `userAgent`, `lastActiveAt`.
  - Grace rule: hash at `prev[0]` and `rotatedAt` within 10s → `RefreshConflict` (no revoke).
- [ ] `TypeOrmSessionRepository`: rotation runs as a single SQL `UPDATE` (SD§2.4), and `affected = 0` → 409.
- [ ] Use cases:
  - `Login`: `VerifyCredentials`, then either an MFA challenge (placeholder until P8) or start a session.
  - `Refresh`: rotate, update `last_active_at`, issue a new access token.
  - `Logout`.
  - `ListDevices` (replica).
  - `RevokeSession` and `RevokeAllSessions`.
- [ ] Refresh cookie: `HttpOnly; Secure; SameSite=Strict; Path=/auth/refresh`. Mobile clients send the refresh token in the body.
- [ ] `AccessTokenGuard` (global, `@Public()` to opt out): verify with the local key and put the actor into `RequestContext`. Revocation check is a placeholder until P6.
- [ ] Controllers `/auth/login`, `/auth/refresh`, `/auth/logout`, `/iam/me/sessions` (GET, DELETE one, DELETE all).
- [ ] `ChangePassword` (moved from Phase 3): authenticated + step-up, reuses `User` password change → `identity.user.password_changed { reason: 'change' }`.
- [ ] Session revocation consumer for `identity.user.password_changed` (revoke all sessions of the user).

**Done when:**
- Every case in Review Focus #1 and #2 has a test.
- An e2e test covers login → refresh ×3 → reuse of an old token → the whole session is revoked.
- A test shows the device list returns IP, UA and `last_active_at`.

## Phase 5 — Organizations, memberships & RBAC

Ref: SD§2, SD§3.2, SD§3.4

- [ ] Domain:
  - `Organization` (`authzEpoch`, `mfaRequired`).
  - `Membership` (`authzVersion`, `assignRole()` guarding cross-tenant assignment, `suspend()`).
  - `Role` with `PermissionSet extends WatchedList<Permission>`.
- [ ] Permission catalog:
  - Seed migration for `permissions` (append-only `bit_index`).
  - Endpoint `GET /internal/permission-catalog` with ETag on `pcv`.
- [ ] `permission-bits.ts` (SD§3.4, verified) into `src/sdk/`. Compute `pbits` on token issue, with Redis cache `perm:membership:{mid}:{mv}:{ov}`.
- [ ] Add `org mid uv mv ov pcv pbits` to the token issuer.
- [ ] `SwitchOrganization` (`POST /auth/session/organization`): active membership, `mfa_required` → 403 `mfa_step_up_required`. No refresh rotation.
- [ ] `PermissionsGuard` + `@RequirePermissions()` + an **org match check against `:orgId`**. Add `StepUpGuard` + `@RequireRecentAuth()`.
- [ ] Use cases and controllers for `/iam/orgs` CRUD, invitations (`one_time_tokens(org_invite)`), member list (replica), role CRUD, and assign/unassign roles. Each change bumps `authzVersion` or `authzEpoch`.

**Done when:**
- Review Focus #3 has tests.
- A user in 2 orgs can switch org and receives the correct `pbits`.
- Deleting a role that is still assigned → 409.

## Phase 6 — Revocation pipeline

Ref: SD§1.2, SD§4.2

- [ ] `revocation/` module: an `IssueRevocation` port, called inside `uow.run()` by the use cases. It writes `revocation_events` and an outbox message `revocation.issued`.
- [ ] Wire all triggers (SD§4.2 table):
  - Lock user and reset/change password → `user`.
  - Logout and remote revoke → `session`.
  - Role changes and suspend → `membership`.
  - Custom role permission changes → `org`.
- [ ] Consumer `revocation-fanout` (worker): `XADD revocations MAXLEN ~ 100000` + `PUBLISH revocations`.
- [ ] `GET /internal/revocations?snapshot=1`: reads `revocation_events WHERE expires_at > now()` from PG. Internal network or mTLS only.
- [ ] Copy `RevocationMap` (SD§1.2, verified) into `src/sdk/` or a shared module. Use it inside auth-srv's `AccessTokenGuard`, which subscribes to the same feed.
- [ ] Cron job (`@nestjs/schedule` + `@nestjs/locks` on Redis) that cleans up expired `revocation_events`.
- [ ] Metric: `revocation_lag_ms`, measured from commit to apply.

**Done when:**
- An integration test shows: suspend member → old token rejected by the guard within 1s → refresh returns 403.
- Review Focus #4 has tests.
- Killing the worker right after commit still delivers within 1s (via another relay).

## Phase 7 — authz-agent, Envoy & SDK

Ref: SD§1.1–1.3

- [ ] `src/agent/main.ts`: `node:http` on a UDS, no Nest DI and no DB. Package it as a separate container or entry.
- [ ] `jwks-cache.ts`: `jose.createLocalJWKSet`, refreshed from auth-api every 5 minutes or on an unknown `kid`.
- [ ] `revocation-feed.ts`:
  - `SUBSCRIBE` + `XREAD` with a cursor every 1s.
  - On Redis errors, fall back to the snapshot from `auth-api` every 2s.
  - `prune()` every 5s.
  - Track a `feedStaleSince` value.
- [ ] ext_authz handler: verify → `check` → 200 with `x-cornal-user/org/session/pcv/pbits`, or 401 `token_stale`.
- [ ] Per-route-prefix policy:
  - `fail-closed` for `/admin/*` and finance routes when the feed has been stale for more than 30s.
  - Otherwise `fail-open` with an alert.
- [ ] Envoy config: `ext_authz` HTTP over UDS, **strip client `x-cornal-*` headers**, timeout 50ms, `failure_mode_allow: false`.
- [ ] SDK `src/sdk/verify-access-token.ts` + `permission-bits.ts`. Prepare extraction into `@cornal/authz` (no Nest imports).
- [ ] Agent readiness probe: JWKS loaded and feed not stale.

**Done when:**
- A k6 run against the agent reaches 10k RPS with p99 under 30ms (target ~2ms).
- After a revoke, a request through Envoy gets 401 in under 5s, including with Redis stopped (fallback path).

## Phase 8 — MFA (TOTP)

Ref: SD§3.5

- [ ] TOTP using RFC 6238 on `node:crypto` HMAC-SHA1, 6 digits / 30s / ±1. Test against the RFC 6238 test vectors.
- [ ] Encrypt the secret with AES-256-GCM, AAD = `user_id`, plus `key_id` for key rotation. Keys come from KMS or an env secret.
- [ ] Enroll (QR `otpauth://`) → confirm with a code → 10 recovery codes stored as HMAC.
- [ ] MFA challenge in Redis (5 min, 5 attempts, bound to `userId` + device fingerprint). Plug it into `Login` from P4.
- [ ] Anti-replay with `UPDATE … WHERE last_used_step < $step`. Single-use recovery codes.
- [ ] Disabling MFA requires step-up, bumps `token_version` and writes an audit event. Honour `org.mfa_required` on login and switch-org.

**Done when:**
- The RFC vectors pass.
- Reusing the same code within one step → rejected.
- Using a recovery code twice → rejected.

## Phase 9 — Google OIDC & account linking

Ref: SD§3.5

- [ ] Authorization Code + PKCE (S256) + `state` + `nonce`, stored in Redis for 10 minutes and bound to a browser cookie.
- [ ] Verify `id_token` with `jose.createRemoteJWKSet(googleCerts)`, checking `iss`, `aud`, `nonce` and `exp`.
- [ ] Linking rules 1–4 (SD§3.5):
  - Auto-link only when both sides have a verified email.
  - Otherwise require logging in to the existing account, then link with step-up.
  - Unlinking requires that at least one other login method remains.
- [ ] Endpoints `/auth/oidc/google/start`, `/auth/oidc/google/callback`, `/iam/me/identities` (list, link, unlink).

**Done when:** these test cases pass:
- Existing identity → login.
- Matching email with both sides verified → auto-link plus a notification email.
- Matching email that is unverified on one side → no link.
- Unlinking the last remaining method → rejected.

## Phase 10 — Audit

Ref: SD§2.3, SD§3.3

- [ ] NATS JetStream transport for the outbox (`ClientProxyTransport`), with a `route` for `audit.*` and the domain events other services need.
- [ ] `AuditRecorder` for events that have no aggregate (failed logins), which also writes to the outbox.
- [ ] `audit-writer` consumer:
  - Batches of ≤ 500 rows or ≤ 200ms, multi-row `INSERT … ON CONFLICT DO NOTHING`.
  - Metadata comes from outbox headers.
- [ ] Map **every** sensitive event in the requirements:
  - Login success and failure, password change, MFA on and off.
  - Session revocation, reuse detected.
  - Role and membership changes, account linking.
- [ ] Partition maintenance job:
  - Create partitions 2 months ahead.
  - Alert when `audit_logs_default` is not empty.
  - Detach partitions older than 13 months.
- [ ] `GET /iam/orgs/:orgId/audit` (replica, cursor pagination, `audit:read`).

**Done when:**
- Each event type in the requirements produces exactly one audit row, even when the consumer runs twice.
- The query uses `audit_logs_org_idx` (check with `EXPLAIN`).

## Phase 11 — Ops & NFR verification

Ref: SD§0.2, SD§1.3, SD§5

- [ ] Deployment manifests: `auth-login` (HPA CPU 50%, `UV_THREADPOOL_SIZE`), `auth-api`, `auth-worker`, the agent sidecar on gateway pods. Set PDB, 3 AZs, `maxUnavailable=0`.
- [ ] PgBouncer x2 (transaction mode, 40 server connections). PG primary + sync standby + replica. Redis with Sentinel. NATS with 3 nodes.
- [ ] Observability:
  - Event loop delay, `HashAdmissionGate.stats`, 503 rate.
  - `revocation_lag_ms`, agent `feedStaleSince`.
  - Outbox backlog and dead letters, refresh 409 rate, `reuse_detected` rate.
- [ ] Load tests (k6):
  - 10k RPS verify through Envoy.
  - Login burst of 150 RPS with p99 under 300ms.
  - Refresh at 250 RPS.
- [ ] Chaos tests: kill Redis, fail over the PG primary, kill auth-login and the worker. Check against the SD§1.3 table.
- [ ] Security tests: brute force, credential stuffing (CAPTCHA trigger), refresh replay, TOTP replay, cross-tenant IDOR, `x-cornal-*` header spoofing.
- [ ] Runbooks:
  - Rotate the JWT key (routine and emergency).
  - Mass revocation.
  - Redis outage.
  - Approval of the fail-open policy.

**Done when:** every NFR in the SD table is measured and recorded, and the runbooks have been rehearsed once.

---

## Decisions to make before or while starting

| Decision | Needed by | Default proposed in the design |
|---|---|---|
| Fail-open policy when the agent's feed is stale for more than 30s | P7 | Fail-closed for `/admin/*` and finance routes, fail-open elsewhere |
| Where JWT keys and the pepper are stored (KMS, Vault, env) | P4 | KMS or a secret manager; env only in dev |
| Gateway: Envoy or an existing gateway | P7 | Envoy with `ext_authz` |
| Email provider | P3 | Port + log adapter; choose a provider later |
| HTTP adapter: Express (current) or `@nestjs/platform-node` | P0 | Keep Express until profiling shows a need |
