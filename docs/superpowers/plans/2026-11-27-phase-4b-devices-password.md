# Phase 4b — Device List, Remote Sign-out, Change Password Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in user can:
- list their active sessions (devices);
- sign out one device, or every other device;
- change their password, which signs out every session.

**Architecture:**
- **`/iam/me/*` routes run in the `api` role**, protected by `AccessTokenGuard`. The guard moves into a small `SessionGuardModule` that `api`, `login` and identity HTTP modules import.
- **Change password belongs to identity.** `User.changePassword()` bumps `tokenVersion` and raises `identity.user.password_changed { reason: 'change' }`. That topic is already registered and already handled by the notice-email consumer.
- **A new session worker consumer** (`session-revoke-on-password-change`) revokes every active session of the user for both `reset` and `change`.

**Tech Stack:** no new dependencies. The raw User-Agent is returned as-is: `ua-parser-js` 2.x is AGPL-3.0, so parsing for display is left to the frontend.

**Spec:**
- Roadmap Phase 4 (4b items).
- `CORNAL_AUTH_SYSTEM_DESIGN.md` §1.1 (device list: IP, UA, last active), §3.5 (password change → revoke sessions, email notice), §4.2 table (remote sign-out).

## Global Constraints

- Every rule from earlier phases still applies. **No commits.**
- **Change password:** requires `currentPassword`. A wrong value counts in the same Redis lockout counter as login (5 failures → 15-minute lock) and answers 401 `IDENTITY.INVALID_CREDENTIALS`. The new password goes through the policy + HIBP + Argon2 gate.
- **Revoking a session the user does not own, or one that does not exist,** → 404 `SESSION.NOT_FOUND`. Never reveal other users' sessions.
- **`DELETE /iam/me/sessions`** revokes every *other* active session and keeps the caller's current one (reason `logout`).
- **Password changed (reset or change)** → every active session of the user is revoked (reason `password_changed`). The client logs in again.
- **Device list fields:** `id`, `current`, `createdAt`, `lastActiveAt`, `ip`, `userAgent`. Ordered by `lastActiveAt` desc, active sessions only.
- **Known until Phase 6:** a revoked session's access token stays valid until it expires (≤ 600s).

## Review Focus

1. **A user revoking another user's session id** → 404, and the target session is untouched. Owner: Task 2 and Task 3.
2. **Wrong current password repeated 5 times** on change-password → the account locks, and login then answers 423. Owner: Task 1.
3. **After a password change, every refresh token of the user is rejected,** including the session that made the change. Owner: Task 4.
4. **The device list never includes revoked or expired sessions.** Owner: Task 2.
5. **"Sign out other devices" keeps the current session working.** Owner: Task 3.

---

### Task 1: Identity — `User.changePassword` + `ChangePasswordUseCase`

**Files:**
- Modify: `domain/user.ts` (+ spec), `contracts/identity.schemas.ts`
- Create: `application/change-password.use-case.ts` (+ spec), exported from `IdentityCoreModule`

**Interfaces:**
- `User.changePassword(newHash, now)`: sets the hash, `tokenVersion += 1`, raises `identity.user.password_changed { reason: 'change' }`.
- `ChangePasswordUseCase.execute({ userId, currentPassword, newPassword }): Result<void, InvalidCredentialsError | AccountLockedError | WeakPasswordError | PasswordBreachedError | ServiceBusyError>`. Order:
  1. Load the user; unknown → InvalidCredentials.
  2. `ensureCanAttemptLogin`.
  3. Policy on the new password.
  4. Verify the current password (gated). Wrong → `registerFailure` (5th failure locks) → InvalidCredentials.
  5. Breach check.
  6. Hash.
  7. `uow`: `changePassword` + save.
  8. Reset the counter.
- `ChangePasswordRequestSchema { currentPassword: 1..256, newPassword: 1..256 }`

- [ ] **Failing tests:**
  - domain: `changePassword replaces hash, bumps tokenVersion, raises password_changed change`
  - use case:
    - `changes the password`
    - `wrong current password → InvalidCredentials and counted; 5th locks`
    - `locked account → AccountLocked without hashing`
    - `weak new password → WeakPassword before verifying`
    - `breached → PasswordBreached, nothing saved`
- [ ] Run, expect FAIL → implement → run, expect PASS.

### Task 2: Session — list / revoke one / revoke all

**Files:**
- Modify:
  - `application/ports.ts`: `SessionRepository.listActiveByUser(userId, now): Promise<Session[]>`
  - `infrastructure/typeorm-session.repository.ts`
  - `contracts/error-codes.ts` + `error-status.ts`: `SESSION.NOT_FOUND` → 404
  - `domain/session.errors.ts`: `SessionNotFoundError`
  - `contracts/session.schemas.ts`: `SessionListResponse`, `SessionIdParamSchema` (uuid)
- Create in `application/`:
  - `list-sessions.use-case.ts`, `revoke-session.use-case.ts`, `revoke-all-sessions.use-case.ts` + specs
- Test: `test/integration/session-repository.int-spec.ts` (new case)

**Interfaces:**
- `ListSessionsUseCase.execute({ userId, currentSessionId }): Promise<SessionView[]>`, where `SessionView = { id, current, createdAt, lastActiveAt, ip, userAgent }`.
- `RevokeSessionUseCase.execute({ userId, sessionId }): Result<void, SessionNotFoundError>`: the session must belong to `userId` and be active.
- `RevokeAllSessionsUseCase.execute({ userId, reason, exceptSessionId? }): Result<{ revoked: number }, never>`

- [ ] **Failing tests:**
  - list: `returns only active sessions of the user, newest activity first, flags current`
  - revoke-one:
    - `revokes own session`
    - `another user's session → SessionNotFound and untouched`
    - `already revoked → SessionNotFound`
  - revoke-all:
    - `revokes all active sessions except the given one`
    - `with no exception revokes all`
  - integration: `listActiveByUser excludes revoked and idle-expired sessions`
- [ ] Run, expect FAIL → implement → run, expect PASS.

### Task 3: HTTP — guard module, `/iam/me/sessions`, `/iam/me/password`, `api` role

**Files:**
- Create:
  - `src/modules/session/session-guard.module.ts`: exports `AccessTokenGuard`; imports SessionCoreModule.
  - `src/modules/session/presentation/me-sessions.controller.ts`
  - `src/modules/identity/presentation/me-password.controller.ts`
  - `src/modules/identity/identity-api.module.ts`
- Modify:
  - `session-http.module.ts`: Http and Api modules use SessionGuardModule; Api adds MeSessionsController.
  - `app.module.ts`: `api` → `[SessionApiModule, IdentityApiModule]`.
  - `rate-limits.ts`: `changePassword` IP 10/hour; `meSessions` IP 120/min.
- Test: `test/e2e/me.e2e-spec.ts`. The app runs role `api` and imports `IdentityHttpModule` + `SessionHttpModule`, so the same app can log in.

**Interfaces:**
- `GET /iam/me/sessions` → 200 `{ sessions: SessionView[] }` (dates as ISO strings)
- `DELETE /iam/me/sessions/:sessionId` → 204
- `DELETE /iam/me/sessions` → 204 `{}` (others revoked)
- `POST /iam/me/password` → 204

- [ ] **Failing e2e:**
  - `lists two devices after two logins, flags the current one, shows ip and user agent`
  - `revoke one own device → its refresh fails, the current still works`
  - `revoking someone else's session id → 404 SESSION.NOT_FOUND, theirs still works`
  - `sign out other devices keeps the current one`
  - `change password: wrong current → 401; correct → 204, old password rejected at login, new accepted`
  - `all /iam/me routes require a bearer token → 401`
- [ ] Run, expect FAIL → implement → run, expect PASS.

### Task 4: Worker — revoke every session on `identity.user.password_changed`

**Files:**
- Create:
  - `src/modules/session/infrastructure/session-revocation.consumer.ts`
  - `src/modules/session/session-worker.module.ts`
- Modify: `app.module.ts` (`worker` → + SessionWorkerModule)
- Test: `test/e2e/me.e2e-spec.ts` (new case, with SessionWorkerModule + IdentityWorkerModule imported and relay `runOnce()`)

**Interfaces:**
- `@OnOutboxMessage('identity.user.password_changed', { consumer: 'session-revoke-on-password-change' })` → `RevokeAllSessionsUseCase({ userId, reason: 'password_changed' })` inside `processInTransaction`.

- [ ] **Failing e2e:** `after change password and relay, every refresh token of the user (including the current session) is rejected`
- [ ] Run, expect FAIL → implement → run, expect PASS.

### Gate (no commit)

- [ ] `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm test:e2e && pnpm test:int && pnpm build` → exit 0, with e2e green on two runs.
- [ ] Manual check: boot `login` + `api` + `worker`. Log in twice, list devices, revoke one, change password, and confirm the refresh fails after the worker runs.
- [ ] Update the roadmap (Phase 4 done). Report, and wait for the commit.
