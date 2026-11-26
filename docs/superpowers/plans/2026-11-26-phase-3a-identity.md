# Phase 3a — Identity Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Users can register with email and password and verify their email through a single-use link.
- The `VerifyCredentials` façade that Phase 4 login will call is in place, with:
  - Argon2id behind an admission gate.
  - A dummy hash for unknown emails.
  - Redis-backed lockout after 5 failures for 15 minutes.
  - Redis-backed rate limits through `@nestjs/throttler`.

**Architecture:**
- **Layout.** `src/modules/identity/{domain,application,infrastructure,presentation}`. Use cases are framework-free and wired with `useFactory` + Symbol tokens.
- **No raw tokens in the outbox.** Registration only emits `identity.user.registered`. The `worker` role's outbox consumer `email-verification` does three things inside `processInTransaction` (one DB transaction):
  1. Issues a fresh token. Only its sha256 is stored, and older open tokens are revoked.
  2. Sends the email.
  3. Records the inbox entry.
- **Failure handling.** A failed send rolls back the transaction, so the retry runs from scratch.
- **Roles.** `login` serves the HTTP endpoints. `worker` runs the consumer.

**Tech Stack:**
- `ioredis@6.0.0` (`6.1.0` fails the 14-day rule) and `@nestjs/throttler@6.7.1` (`6.8.0` fails it too). Both are installed already.
- `node:crypto` for `argon2`, `randomBytes`, `createHash` and `timingSafeEqual`.
- Existing: TypeORM 1.1.2, `@nestjs/outbox` 0.1.4.

**Spec:**
- `2026-11-26-cornal-auth-roadmap.md` Phase 3, items for 3a.
- `CORNAL_AUTH_SYSTEM_DESIGN.md` §2.2 (`users`, `password_credentials`, `one_time_tokens`), §2.4 (Redis failure counter), §3.3 (login order, `HashAdmissionGate`, verified code), §3.5 (registration).
- `CORNAL_AUTH_ARCHITECTURE_PLAYBOOK.md` §2.4–2.5 (`User`, `Email`, `RegisterUserUseCase`, `Argon2PasswordHasher`, verified code).

## Global Constraints

- Every rule from Phases 0–2 still applies. **No commits.**
- Argon2id parameters: m=19456, t=2, p=1, tagLength=32, stored as a PHC string. Optional pepper `PASSWORD_PEPPER` (at least 32 characters).
- Password policy: 12–256 characters (the upper bound caps Argon2 cost), and not blank after trim. The HIBP check comes in Phase 3b.
- Lockout: 5 failures within 15 minutes → `user.lock()` for 15 minutes.
- Same error for an unknown email and a wrong password: `IDENTITY.INVALID_CREDENTIALS`.
- Email-verification token: 32 random bytes, base64url, 24-hour TTL, single use, stored as sha256.
- Rate limits, keyed by IP / `sha256(lowercased email)` / both:

  | Route | IP | Email | IP+email |
  |---|---|---|---|
  | `register` | 10 / hour | 3 / hour | — |
  | `verify-email` | 30 / 15 min | — | — |
  | `login` (Phase 4) | 20 / min | 10 / 15 min | 5 / min |

- Redis is down → the rate limiter falls back to in-process counters at **double weight** (stricter), and the lockout counter fails closed: login returns 503. Redis commands fail fast (`enableOfflineQueue: false`, `maxRetriesPerRequest: 1`).
- Gate saturated → **503 `COMMON.SERVICE_UNAVAILABLE` with `Retry-After: 1`**. The filter keeps 503 `DomainError`s visible; only 500 collapses to INTERNAL.

## Review Focus

1. **Unknown email:** `hasher.verify` still runs, against `DUMMY_PASSWORD_HASH`, and returns the same error as a wrong password. Owner: Task 5.
2. **Concurrent registration with the same email:** one 201, the other 409 `IDENTITY.EMAIL_TAKEN`, caught from the unique index when the pre-check races. Owner: Task 3 and Task 6.
3. **Verification token used twice, or after expiry:** the second or expired use → 400 `IDENTITY.INVALID_TOKEN`; the user is verified only once. Owner: Task 3 and Task 5.
4. **Email send fails in the consumer:** no token row is committed and the message is retried. On retry exactly one open token exists. Owner: Task 6.
5. **11th registration from one IP within an hour:** 429 `COMMON.RATE_LIMITED` with `Retry-After`. When Redis is down, limiting still happens per pod (never fail-open). Owner: Task 2 and Task 6.

---

### Task 1: Contracts + identity domain

**Files:**
- Modify: `src/contracts/error-codes.ts`, `src/shared/infrastructure/http/error-status.ts`
- Create:
  - `src/contracts/identity.schemas.ts`
  - `src/modules/identity/domain/{email,identity.errors,password-policy,user}.ts`
- Test: `src/modules/identity/domain/{email,password-policy,user}.spec.ts`

**Interfaces:**
- `IdentityErrorCode`:

  | Key | Code | HTTP |
  |---|---|---|
  | `InvalidEmail` | `'IDENTITY.INVALID_EMAIL'` | 422 |
  | `WeakPassword` | `'IDENTITY.WEAK_PASSWORD'` | 422 |
  | `EmailTaken` | `'IDENTITY.EMAIL_TAKEN'` | 409 |
  | `InvalidCredentials` | `'IDENTITY.INVALID_CREDENTIALS'` | 401 |
  | `AccountLocked` | `'IDENTITY.ACCOUNT_LOCKED'` | 423 |
  | `InvalidToken` | `'IDENTITY.INVALID_TOKEN'` | 400 |

  `ErrorCode = CommonErrorCode | IdentityErrorCode`.
- Schemas, all `z.strictObject`:
  - `RegisterRequestSchema { email: string ≤254, password: string 1..256 }`
  - `VerifyEmailRequestSchema { token: string matching /^[A-Za-z0-9_-]{43}$/ }`
  - `RegisterResponse { userId: string }`
- `Email`: copy Playbook `email.ts` verbatim.
- `checkPasswordPolicy(plain: string): Result<void, WeakPasswordError>`
- `User`, adapted from Playbook `user.ts`:
  - Props: `{ email, emailVerifiedAt: Date | null, passwordHash: string | null, status: 'active' | 'locked' | 'disabled', lockedUntil: Date | null, tokenVersion: number, createdAt }`.
  - Methods:
    - `static register({ email, passwordHash, now })` raises `identity.user.registered { email }`.
    - `static reconstitute(id, props, version)`
    - `verifyEmail(now)`: idempotent, raises `identity.user.email_verified` the first time only.
    - `ensureCanAttemptLogin(now): Result<void, AccountLockedError | InvalidCredentialsError>`: `disabled` → InvalidCredentials; `locked` and `lockedUntil > now` → AccountLocked.
    - `lock(now, durationMs)` raises `identity.user.locked { until }`.
    - `clearExpiredLock(now): boolean`: returns true if it changed state.
    - Getters for every prop.
  - `UserId = Id<'User'>`.

- [ ] **Failing specs:**
  - `email.spec.ts`: `normalizes case and whitespace`, `rejects missing @ and >254 chars`.
  - `password-policy.spec.ts`: `rejects < 12 chars`, `rejects > 256 chars`, `rejects whitespace-only`, `accepts a 12-char passphrase`.
  - `user.spec.ts`:
    - `register raises identity.user.registered`
    - `verifyEmail is idempotent and raises once`
    - `ensureCanAttemptLogin: locked until future → AccountLocked; expired lock → ok; disabled → InvalidCredentials`
    - `lock raises identity.user.locked with until`
- [ ] Run `pnpm test src/modules/identity`. Expected: FAIL. Implement. Run again. Expected: PASS. Also run `pnpm exec tsc --noEmit`, which checks the `ERROR_STATUS` table covers every new code.

### Task 2: Redis module, throttler storage, login-attempt counter

**Files:**
- Create:
  - `src/shared/infrastructure/redis/redis.module.ts` (global; provides `REDIS`, registers the `redis` readiness probe, and calls `quit()` on destroy)
  - `src/shared/infrastructure/redis/redis-throttler.storage.ts`
  - `src/modules/identity/infrastructure/redis-login-attempt-counter.ts`
- Modify: `src/app.module.ts` (`RedisModule` for every role)
- Test: `test/integration/redis-throttler.storage.int-spec.ts`, `test/integration/login-attempt-counter.int-spec.ts`

**Interfaces:**
- `REDIS = Symbol('REDIS')` holds an ioredis `Redis` instance created from `REDIS_URL` with `{ enableOfflineQueue: false, maxRetriesPerRequest: 1, lazyConnect: false }`.
- `RedisThrottlerStorage implements ThrottlerStorage`:
  - `increment(key, ttl, limit, blockDuration, name)` runs one atomic Lua script over the keys `thr:{name}:{key}` and `thr:{name}:{key}:block`:
    1. If the block key exists, return blocked.
    2. Otherwise `INCR`; on the first hit set `PEXPIRE ttl`.
    3. If hits exceed the limit and `blockDuration > 0`, set the block key with `PX blockDuration`.
  - On a Redis error it logs a warning once per minute and delegates to an in-memory `ThrottlerStorageService`, returning `totalHits × 2`.
- `LoginAttemptCounter` port (in `application/ports.ts`, Task 5) with `registerFailure(userId): Promise<number>` and `reset(userId): Promise<void>`. The Redis adapter uses the key `login:fail:{userId}`, `INCR` + `EXPIRE 900` on the first failure, and `DEL` to reset. Errors propagate (fail closed).

- [ ] **Failing tests:**
  - storage:
    - `counts hits within ttl and reports timeToExpire`
    - `blocks after limit for blockDuration`
    - `separate throttler names do not share counters`
    - `falls back to in-memory double-weight counting when Redis is unreachable` (a second client pointed at an unused port)
  - counter:
    - `increments per user and expires`
    - `reset clears`
- [ ] Run `pnpm test:int`. Expected: FAIL → implement → PASS. The readiness e2e must still pass, now with `redis` up.

### Task 3: Persistence — records, mappers, repositories

**Files:**
- Create in `src/modules/identity/infrastructure/`:
  - `user.record.ts`, `password-credential.record.ts`, `one-time-token.record.ts`
  - `user.mapper.ts`
  - `typeorm-user.repository.ts`, `typeorm-one-time-token.repository.ts`
- Test: `test/integration/identity-repositories.int-spec.ts`

**Interfaces** (the ports are declared in Task 5's `application/ports.ts`; create that file here with these two):
- `UserRepository`:
  - `findById(id): Promise<User | undefined>`
  - `findByEmail(email: Email): Promise<User | undefined>`
  - `save(user): Promise<void>`
  - Implementation: inserts or updates `users`, upserts `password_credentials` when `passwordHash !== null`, uses optimistic `version`, maps unique violation `users_email_uq` → throws `EmailTakenError`, then `markPersisted` + `track`.
- `OneTimeTokenRepository`:
  - `issue({ purpose, userId, tokenHash, expiresAt }): Promise<void>`
  - `revokeOpen(userId, purpose): Promise<void>`, which sets `consumed_at = now()` on open tokens.
  - `consume(purpose, tokenHash, now): Promise<{ userId: UserId } | undefined>`: one atomic `UPDATE … WHERE token_hash = $1 AND purpose = $2 AND consumed_at IS NULL AND expires_at > $3 RETURNING user_id`.
- Records use explicit column types (no reflected metadata) and are registered via `TypeOrmModule.forFeature` in the identity module (Task 6). Tests register them on the test `DataSource`.

- [ ] **Failing tests:**
  - `save then findByEmail round-trips user + password hash`
  - `findByEmail is case-insensitive (citext)`
  - `duplicate email on insert throws EmailTakenError`
  - `stale version throws ConcurrencyConflictError`
  - `consume returns userId once, then undefined`
  - `consume of an expired token returns undefined`
  - `revokeOpen makes earlier tokens unusable`
- [ ] Run, expect FAIL → implement → run, expect PASS.

### Task 4: Hashing — Argon2 + admission gate + 503 handling

**Files:**
- Create:
  - `src/modules/identity/infrastructure/argon2-password-hasher.ts` (Playbook verbatim, plus `DUMMY_PASSWORD_HASH` computed once at module load from a random secret)
  - `src/shared/infrastructure/hash-admission-gate.ts` (SD §3.3 verbatim)
  - `src/modules/identity/infrastructure/gated-password-hasher.ts`
  - `src/shared/domain/service-busy.error.ts`
- Modify: `src/shared/infrastructure/http/app-exception.filter.ts` (503 domain errors pass through; set `Retry-After` from `details.retryAfterSeconds`)
- Test:
  - `src/modules/identity/infrastructure/argon2-password-hasher.spec.ts` (Playbook spec)
  - `src/shared/infrastructure/hash-admission-gate.spec.ts`
  - `src/modules/identity/infrastructure/gated-password-hasher.spec.ts`
  - new e2e in `errors.e2e-spec.ts`

**Interfaces:**
- `PasswordHasher` port:
  - `hash(plain): Promise<Result<string, ServiceBusyError>>`
  - `verify(plain, encoded): Promise<Result<boolean, ServiceBusyError>>`
  - `needsRehash(encoded): boolean`
- `ServiceBusyError extends DomainError<'COMMON.SERVICE_UNAVAILABLE'>` with `details: { retryAfterSeconds: number }`.
- `GatedPasswordHasher(inner: Argon2PasswordHasher, gate: HashAdmissionGate)`: `gate.run()` returning `undefined` → `err(new ServiceBusyError(1))`.
- Gate size: `HASH_MAX_CONCURRENCY` (env, default `os.availableParallelism()`); queue = 2 × that.

- [ ] **Failing tests:**
  - argon2: `verifies right / rejects wrong`, `malformed hash → false`, `DUMMY_PASSWORD_HASH is a valid argon2id PHC string`.
  - gate: `caps concurrency and sheds beyond queue`.
  - gated: `returns ServiceBusyError when the gate is saturated`.
  - e2e: `ServiceBusyError → 503 SERVICE_UNAVAILABLE with Retry-After: 1`.
- [ ] Run, expect FAIL → implement → run, expect PASS.

### Task 5: Use cases

**Files:**
- Create in `src/modules/identity/application/`:
  - `ports.ts` (adds to Task 3: `PasswordHasher`, `LoginAttemptCounter`, `SecretTokenGenerator`, `EmailSender`, and the tokens)
  - `register-user.use-case.ts`
  - `issue-email-verification.use-case.ts`
  - `verify-email.use-case.ts`
  - `verify-credentials.use-case.ts`
- Create: `src/modules/identity/infrastructure/node-secret-token-generator.ts`
- Test: one `*.spec.ts` per use case, with in-memory fakes, a passthrough UoW and `vi.fn()` handles.

**Interfaces:**
- `SecretTokenGenerator.generate(): { raw: string; hash: string }`: raw = base64url of 32 bytes, hash = sha256 hex.
- `EmailSender.send(message: { to: string; template: 'verify-email'; data: { link: string } }): Promise<void>`
- `RegisterUserUseCase.execute({ email, password }): Promise<Result<{ userId }, InvalidEmailError | WeakPasswordError | EmailTakenError | ServiceBusyError>>`. Order: policy → email → hash (outside the UoW) → `uow.run(findByEmail → EmailTaken | User.register → save)`.
- `IssueEmailVerificationUseCase.execute({ userId }): Promise<Result<'sent' | 'already_verified' | 'user_missing', never>>`. Inside `uow.run`: load user → `revokeOpen` → `issue` (TTL 24h) → `emailSender.send({ link: \`${EMAIL_VERIFICATION_URL}?token=${raw}\` })`.
- `VerifyEmailUseCase.execute({ token }): Promise<Result<void, InvalidTokenError>>`. Inside `uow.run`: `consume('email_verify', sha256(token), now)` → load user → `verifyEmail` → save.
- `VerifyCredentialsUseCase.execute({ email, password }): Promise<Result<{ userId; emailVerified: boolean }, InvalidCredentialsError | AccountLockedError | ServiceBusyError>>`. Order:
  1. Parse the email; an invalid email → InvalidCredentials, after a dummy verify.
  2. `findByEmail`.
  3. If the user exists → `ensureCanAttemptLogin`.
  4. `hasher.verify(password, user?.passwordHash ?? DUMMY)`.
  5. Busy → `ServiceBusyError`.
  6. Wrong or no user → if the user exists, `counter.registerFailure`; at ≥ 5 → `uow.run(lock + save)`. Return InvalidCredentials.
  7. Correct → `counter.reset`; if `clearExpiredLock` changed state → `uow.run(save)`. Return ok.

  The dummy hash is injected as a constructor argument, so tests can assert it is used.

- [ ] **Failing tests:**
  - register:
    - `registers and saves with hashed password`
    - `weak password → WeakPassword, hasher not called`
    - `taken email → EmailTaken`
    - `busy hasher → ServiceBusyError, nothing saved`
  - issue:
    - `revokes open tokens, issues one hashed token, emails the raw token link`
    - `already verified → no email`
    - `email failure propagates (so the outbox retries)`
  - verify-email:
    - `valid token verifies user`
    - `unknown token → InvalidToken`
  - verify-credentials:
    - `unknown email verifies against the dummy hash and returns InvalidCredentials`
    - `wrong password increments counter; 5th failure locks and saves`
    - `locked user → AccountLocked without hashing`
    - `correct password resets counter`
    - `busy → ServiceBusyError`
- [ ] Run `pnpm test`. Expected: FAIL → implement → PASS.

### Task 6: Wiring — module, HTTP endpoints, throttling, consumer, env

**Files:**
- Create in `src/modules/identity/`:
  - `identity-core.module.ts` (repositories, adapters, use cases via `useFactory`, `forFeature`)
  - `identity-http.module.ts` (controller)
  - `identity-worker.module.ts` (consumer)
  - `presentation/identity.controller.ts`
  - `infrastructure/email-verification.consumer.ts`
  - `infrastructure/log-email-sender.ts`
- Create: `src/shared/infrastructure/throttling/throttling.module.ts`, `src/shared/infrastructure/throttling/rate-limits.ts`
- Modify:
  - `src/config/env.schema.ts` + spec + `.env.example`: `EMAIL_VERIFICATION_URL` (url, default `http://localhost:3000/verify-email`), `HASH_MAX_CONCURRENCY` (int, optional), `PASSWORD_PEPPER` (min 32, optional).
  - `src/app.module.ts`: `login` → IdentityHttpModule; `worker` → IdentityWorkerModule.
  - `test/e2e/support/create-app.ts`: `extra.imports`, `extra.overrides: [{ token, value }]`.
- Test: `test/e2e/identity.e2e-spec.ts`, `test/integration/email-verification.consumer.int-spec.ts`

**Interfaces:**
- `POST /auth/register` → 201 `{ userId }`, throttled by `register`.
- `POST /auth/verify-email` → 204, throttled by `verify-email`.
- The guard is `ThrottlerGuard` on `IdentityController` only. `/health` is never throttled.
- Throttlers `ip`, `email`, `ipEmail`, with `getTracker` = `req.ip`, `sha256(lowercased body.email)`, and both. `email` and `ipEmail` use `skipIf` when there is no email in the body.
- Consumer: `@OnOutboxMessage('identity.user.registered', { consumer: 'email-verification' })`. It runs `uow.run(() => ctx.processInTransaction(tx.requireManager(), () => issueEmailVerification.execute(...)))`, so the token row, the inbox row and a successful send commit together.

- [ ] **Failing e2e** (`identity.e2e-spec.ts`; app role `login` + IdentityWorkerModule + a capturing fake `EMAIL_SENDER`; each test uses its own `X-Forwarded-For` IP):
  - `register → 201 with userId; user row exists, unverified`
  - `duplicate email (different case) → 409 IDENTITY.EMAIL_TAKEN`
  - `weak password → 422 IDENTITY.WEAK_PASSWORD`
  - `full verification flow: register → relay.runOnce() → one email captured → POST verify-email with its token → 204 → emailVerified`
  - `reusing the token → 400 IDENTITY.INVALID_TOKEN`
  - `11th register from one IP within the window → 429 COMMON.RATE_LIMITED with Retry-After`
  - `concurrent registrations of the same email → one 201, one 409`
- [ ] **Failing integration** (`email-verification.consumer.int-spec.ts`): `send failure → no token row committed, message retried; next run sends once and leaves exactly one open token`.
- [ ] Run `pnpm test:e2e && pnpm test:int`. Expected: FAIL → implement → PASS.

### Gate (no commit)

- [ ] `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm test:e2e && pnpm test:int && pnpm build` → exit 0.
- [ ] Manual check: boot `APP_ROLE=login` and `APP_ROLE=worker` against the dev DB (after `db:migrate`). `curl` register shows a 201, the worker log shows the verification link, and `curl` verify-email shows a 204.
- [ ] Report to the user and wait for their commit.
