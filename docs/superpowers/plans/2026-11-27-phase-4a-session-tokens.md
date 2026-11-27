# Phase 4a — Login, Tokens, Refresh Rotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Users can log in with email and password and receive:
  - an ES256 access token (600s);
  - an opaque refresh token, as an HttpOnly cookie on web or in the body for mobile.
- Users can refresh with rotation and reuse detection.
- Users can log out.
- Other services can verify tokens through `/.well-known/jwks.json`.
- `AccessTokenGuard` protects routes.

**Architecture:**
- **Module layout.** New `session` module (domain / application / infrastructure / presentation).
- **Session.** One `Session` aggregate = one refresh-token family.
- **Refresh token.** Format `<sessionId>.<base64url(32 bytes)>`. Only sha256 of the secret is stored, plus the last 5 previous hashes.
- **Rotation outcomes:**
  - The current hash → rotate.
  - `prev[0]` within 10s → 409 conflict (a second tab racing, no revoke).
  - Any other previous hash → revoke the family (reuse detected).
  - Unknown hash → 401 without revoking, so knowing only the `sid` cannot kill a session.
- **Concurrency.** Optimistic version, so two concurrent refreshes cannot both win.
- **Boundaries.** Session talks to identity only through exported façades: `VerifyCredentialsUseCase` and a new `GetUserAuthStateUseCase`. Session never touches identity tables.

**Tech Stack:** `jose@6.2.17` (`6.2.18` fails the 14-day rule), `node:crypto`, the existing kernel (UoW, outbox registry, throttling), TypeORM SQL repositories.

**Spec:**
- Roadmap Phase 4, split by user decision. 4b covers the device list, remote revoke, change password and revoke-on-password-change.
- `CORNAL_AUTH_SYSTEM_DESIGN.md` §2.2 (`sessions` DDL), §2.4 (rotation UPDATE), §3.4 (claims), §4.1 (rotation and reuse sequence).
- `CORNAL_AUTH_ARCHITECTURE_PLAYBOOK.md` §4.3 (verified `Session.rotate`, extended here).
- User decisions: PEM through env plus a dev key script; cookie + mobile body.

## Global Constraints

- Every rule from earlier phases still applies. **No commits.**
- **Access token:**
  - Header: ES256 with `kid`.
  - Claims: `iss`, `aud`, `sub`, `sid`, `jti` (UUIDv7), `iat`, `exp` (`ACCESS_TOKEN_TTL_SECONDS`, default 600), `auth_time`, `amr` (`['pwd']`), `uv` (the user's tokenVersion).
  - Organisation claims arrive in Phase 5.
- **Keys:**
  - `JWT_SIGNING_KEYS` is a JSON array `[{ "kid": string, "pem": PKCS#8 P-256 }]`. Index 0 signs; every key is published in the JWKS.
  - Required when `NODE_ENV=production`.
  - Otherwise, if it is absent, an ephemeral key is generated at boot with a warning.
- **TTLs:** `REFRESH_IDLE_TTL_SECONDS` default 14 days; `REFRESH_ABSOLUTE_TTL_SECONDS` default 30 days. Rotation never extends past the absolute expiry.
- **Cookie:** name `cornal_rt`, `HttpOnly; Secure; SameSite=Strict; Path=/auth`, `Max-Age` = idle TTL. Logout clears it.
- **Mobile:** the request header `X-Client-Type: mobile` → `refreshToken` comes back in the JSON body; refresh accepts `{ refreshToken }` in the body.
- **Error codes:**

  | Code | HTTP | Notes |
  |---|---|---|
  | `SESSION.INVALID` | 401 | Response carries `WWW-Authenticate: Bearer` for guard failures |
  | `SESSION.REFRESH_CONFLICT` | 409 | |

- **Rate limit:** `refresh` IP 60/min. `login` limits already exist in `RATE_LIMITS.login`.
- **Login is not blocked on email verification.** The token carries no organisation until Phase 5.

## Review Focus

1. **Reuse of a rotated refresh token** (not within the grace window) → 401. The whole session is revoked, so the legitimate newer token also gets 401. `session.refresh_reuse_detected` is raised. Owner: Tasks 3, 6, 7.
2. **Two concurrent refreshes with the same token** → exactly one 200, the other 409. The session is not revoked. Owner: Tasks 6 and 7.
3. **A token with a valid `sid` but a random secret** → 401, and the session stays usable. Owner: Tasks 3 and 7.
4. **An access token from another issuer or audience, expired, signed by an unknown key, or `alg: none`** → 401 from the guard. Owner: Task 4.
5. **A disabled or locked user refreshing** → 401, and the session is revoked. Owner: Task 6.

---

### Task 1: Config — JWT and TTL variables; test configs derive from `parseConfig`; dev key script

**Files:**
- Modify:
  - `src/config/env.schema.ts` + spec + `.env.example`
  - `package.json` (script `keys:generate`)
  - `test/e2e/support/create-app.ts`, `test/integration/support/persistence-app.ts`, `src/shared/infrastructure/logging/logger.options.test-support.ts`: build their config with `parseConfig(minimal env strings)` + overrides, so new variables never need three edits again.
- Create: `scripts/generate-signing-key.mjs`, which prints a `JWT_SIGNING_KEYS=[...]` line for `.env`.

**Interfaces:**
- `JWT_SIGNING_KEYS`: optional JSON string → `readonly { kid: string; pem: string }[]` (at least 1 entry; `pem` starts with `-----BEGIN PRIVATE KEY-----`). Required in production.
- `JWT_ISSUER`: url, default `http://localhost:3001`.
- `JWT_AUDIENCE`: default `cornal-platform`.
- `ACCESS_TOKEN_TTL_SECONDS`: 60–900, default 600.
- `REFRESH_IDLE_TTL_SECONDS`: default 1209600.
- `REFRESH_ABSOLUTE_TTL_SECONDS`: default 2592000; must be ≥ idle.

- [ ] **Failing tests:**
  - `JWT_SIGNING_KEYS parses a JSON key list`
  - `rejects malformed JWT_SIGNING_KEYS`
  - `requires JWT_SIGNING_KEYS in production`
  - `token TTL defaults`
  - `absolute TTL must not be shorter than idle`
- [ ] Run, expect FAIL → implement → run, expect PASS. Also `node scripts/generate-signing-key.mjs` → its output parses with `parseConfig`, covered by a spec that runs the script through `node:child_process`.

### Task 2: Identity façades for session

**Files:**
- Modify: `application/verify-credentials.use-case.ts` (+ spec): `VerifiedCredentials` gains `tokenVersion: number`.
- Create: `application/get-user-auth-state.use-case.ts` (+ spec), exported from `IdentityCoreModule`.

**Interfaces:**
- `GetUserAuthStateUseCase.execute({ userId }): Promise<{ tokenVersion: number; canAuthenticate: boolean } | undefined>`. `canAuthenticate` = status `active`, or a lock that has expired.

- [ ] **Failing tests:**
  - `verify-credentials returns tokenVersion`
  - `auth state: active → canAuthenticate`
  - `auth state: disabled → false`
  - `auth state: lock in force → false`
  - `auth state: unknown → undefined`
- [ ] Run, expect FAIL → implement → run, expect PASS.

### Task 3: Session domain, errors, contracts

**Files:**
- Create:
  - `src/modules/session/domain/{session,session.errors}.ts` + `session.spec.ts`
  - `src/contracts/session.schemas.ts`
- Modify: `src/contracts/error-codes.ts`, `error-status.ts`

**Interfaces:**
- `Session` props:
  - `userId`, `refreshHash`, `prevRefreshHashes: readonly string[]` (newest first, at most 5)
  - `rotatedAt`, `idleExpiresAt`, `absoluteExpiresAt`
  - `revokedAt`, `revokeReason`
  - `amr: readonly string[]`, `authTime`
  - `ip`, `userAgent`, `createdAt`, `lastActiveAt`
- `Session.start({ userId, refreshHash, now, idleTtlMs, absoluteTtlMs, amr, ip, userAgent })` raises `session.started`.
- `rotate({ presentedHash, nextHash, now, idleTtlMs, ip, userAgent }): Result<void, SessionInvalidError | RefreshConflictError>`. Outcomes in order:
  1. Revoked or expired → invalid.
  2. Current hash → rotate.
  3. `prev[0]` and `now - rotatedAt < 10s` → conflict.
  4. Any previous hash → `revoke('reuse_detected')` + `session.refresh_reuse_detected`, then invalid.
  5. Otherwise → invalid, with no state change.
- `revoke(reason: 'logout' | 'reuse_detected' | 'user_inactive' | 'admin' | 'password_changed', now)`: idempotent; raises `session.revoked`.
- Schemas:
  - `LoginRequestSchema { email ≤254, password 1..256 }`
  - `RefreshRequestSchema { refreshToken?: string }` (strict)
  - `TokenResponse { accessToken, tokenType: 'Bearer', expiresIn, refreshToken? }`
  - `SessionInfoResponse { userId, sessionId, authTime, amr }`

- [ ] **Failing tests:**
  - `start raises session.started`
  - `rotate with current hash moves it to prev and extends idle`
  - `prev[0] within 10s → conflict, no revoke`
  - `older previous hash → revoke + reuse event`
  - `unknown hash → invalid, nothing changes`
  - `idle expired → invalid`
  - `never extends past absolute expiry`
  - `prev keeps at most 5`
  - `revoke is idempotent`
- [ ] Run, expect FAIL → implement → run, expect PASS.

### Task 4: Crypto infrastructure — key ring, token issuer/verifier, refresh token factory, cookie parsing

**Files:**
- Create in `src/modules/session/infrastructure/`:
  - `key-ring.ts`, `jose-token-service.ts`, `node-refresh-token-factory.ts` + specs
- Create: `src/modules/session/presentation/refresh-cookie.ts` + spec
- Create: `src/modules/session/application/ports.ts` (`ACCESS_TOKEN_ISSUER`, `REFRESH_TOKEN_FACTORY`, `SESSION_REPOSITORY`, `CREDENTIALS_VERIFIER`, `USER_AUTH_STATE`)

**Interfaces:**
- `KeyRing.fromConfig(keys | undefined, nodeEnv): Promise<KeyRing>` (ephemeral when undefined and not production). Exposes `signer: { kid, key }` and `jwks(): { keys: JWK[] }` (`alg: 'ES256'`, `use: 'sig'`, `kid`).
- `JoseTokenService`:
  - `issue(claims: AccessClaims): Promise<{ token: string; expiresIn: number }>`
  - `verify(token): Promise<AccessClaims | undefined>`: pins the algorithm to ES256, checks `iss`/`aud`/`exp`, picks the key by `kid`.
  - `AccessClaims = { sub, sid, uv, amr, authTime }`.
- `NodeRefreshTokenFactory`:
  - `create(sessionId): { raw, hash }`
  - `newSecret(): { secret, hash }`
  - `format(sid, secret): string`
  - `parse(raw): { sessionId: SessionId; hash: string } | undefined`
- `readRefreshCookie(cookieHeader: string | undefined): string | undefined`
- `refreshCookieOptions(maxAgeSeconds)`

- [ ] **Failing tests:**
  - `issue → verify round-trip carries claims and kid`
  - `rejects wrong audience, wrong issuer, expired, foreign key, alg none`
  - `jwks lists every key without private parts`
  - `ephemeral key in development, refused in production`
  - `refresh token format/parse round-trip; garbage → undefined`
  - `cookie parser finds cornal_rt among others; absent → undefined`
- [ ] Run, expect FAIL → implement → run, expect PASS.

### Task 5: Session repository (SQL)

**Files:**
- Create: `src/modules/session/infrastructure/typeorm-session.repository.ts`
- Test: `test/integration/session-repository.int-spec.ts`

**Interfaces:**
- `SessionRepository.findById(id): Promise<Session | undefined>` and `save(session)`. `save` inserts on version 0, otherwise `UPDATE … WHERE id AND version` → `ConcurrencyConflictError`, then `markPersisted` + `track`.
- Hashes are hex in the domain and `bytea` / `bytea[]` in SQL, converted with `decode` / `encode` in SQL.

- [ ] **Failing tests:**
  - `round-trips a session including prev hashes, amr, ip, ua`
  - `stale version → ConcurrencyConflictError`
- [ ] Run, expect FAIL → implement → run, expect PASS.

### Task 6: Use cases — login, refresh, logout, current session

**Files:**
- Create in `src/modules/session/application/`:
  - `login.use-case.ts`, `refresh-session.use-case.ts`, `logout.use-case.ts` + specs
  - `session.test-support.ts`

**Interfaces:**
- `LoginUseCase.execute({ email, password, ip, userAgent }): Result<IssuedTokens, VerifyCredentialsError>`, where `IssuedTokens = { accessToken, expiresIn, refreshToken, refreshMaxAgeSeconds }`.
- `RefreshSessionUseCase.execute({ refreshToken, ip, userAgent }): Result<IssuedTokens, SessionInvalidError | RefreshConflictError>`.
  - Reuse and user-inactive revocations are **committed**: the UoW returns `ok({ kind: 'revoked' })`, and the error is mapped outside the UoW.
  - `ConcurrencyConflictError` → `RefreshConflictError`.
- `LogoutUseCase.execute({ refreshToken }): Result<void, never>`: idempotent; an unknown or garbage token is ok.

- [ ] **Failing tests:**
  - login:
    - `issues access + refresh, saves session with amr pwd and uv`
    - `invalid credentials pass through`
  - refresh:
    - `rotates and issues new tokens`
    - `reuse → session revoked and saved, SessionInvalid`
    - `racing version → RefreshConflict`
    - `inactive user → session revoked, SessionInvalid`
    - `garbage token → SessionInvalid`
  - logout:
    - `revokes the session`
    - `unknown token is ok`
- [ ] Run, expect FAIL → implement → run, expect PASS.

### Task 7: Wiring — modules, controllers, guard, JWKS, roles, e2e

**Files:**
- Create in `src/modules/session/`:
  - `session-core.module.ts`, `session-http.module.ts`
  - `presentation/{session.controller,jwks.controller,access-token.guard,current-auth.decorator}.ts`
- Modify:
  - `src/app.module.ts`: `login` → SessionHttpModule (auth endpoints + JWKS); `api` → JWKS + guard via SessionHttpModule.
  - `rate-limits.ts` (`refresh`)
  - `.claude/rules/architecture.md` (session ↔ identity façade rule)
- Test: `test/e2e/session.e2e-spec.ts`

**Interfaces:**
- `POST /auth/login` → 200 `TokenResponse` + cookie (or a body `refreshToken` for mobile).
- `POST /auth/refresh` → 200 `TokenResponse` + rotated cookie.
- `POST /auth/logout` → 204 + cleared cookie.
- `GET /auth/session` (AccessTokenGuard) → `SessionInfoResponse`.
- `GET /.well-known/jwks.json` → public JWKS (`Cache-Control: public, max-age=300`).
- `AccessTokenGuard` reads `Authorization: Bearer`, verifies, sets `request.auth` and `RequestContext.actorId`. Failures → `SessionInvalidError` (401).

- [ ] **Failing e2e** (role `login`, unique IPs):
  - `login → 200 with ES256 token whose kid is in the JWKS, HttpOnly SameSite=Strict cookie`
  - `wrong password → 401 IDENTITY.INVALID_CREDENTIALS`
  - `GET /auth/session with the access token → 200; without → 401 SESSION.INVALID`
  - `refresh with cookie rotates; the previous cookie is now invalid`
  - `reusing an old refresh token revokes the session: the newest token fails too`
  - `concurrent refresh with one token → one 200, one 409`
  - `random secret with a valid sid → 401, and the real token still works`
  - `mobile: X-Client-Type mobile gets refreshToken in body and can refresh with it`
  - `logout → 204, cookie cleared, refresh → 401`
- [ ] Run `pnpm test:e2e`. Expected: FAIL → implement → PASS.

### Gate (no commit)

- [ ] `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm test:e2e && pnpm test:int && pnpm build` → exit 0, with e2e green on two consecutive runs.
- [ ] Manual check:
  1. `pnpm keys:generate >> .env` (local only).
  2. Boot `login` → register + verify email (Mailpit) → login → refresh → logout with curl.
  3. Decode the token header and check `kid` against `/.well-known/jwks.json`.
- [ ] Update the roadmap (4a done). Report, and wait for the commit.

**Known gap until Phase 6:** a logged-out or revoked session's access token stays valid until it expires (≤ 600s), because the revocation map arrives in Phase 6.
