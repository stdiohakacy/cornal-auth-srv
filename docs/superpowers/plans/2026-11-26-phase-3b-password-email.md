# Phase 3b — Password Reset, Breach Check & Real Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Users can reset a forgotten password through a single-use emailed link.
- New passwords are screened against HIBP (k-anonymity, can be disabled with a flag).
- Emails leave through `@nestjs/mail` over SMTP. Mailpit receives them in development.

**Architecture:**
- **Tokens stay out of the outbox (same rule as 3a).**
  - `POST /auth/password/forgot` only records `identity.user.password_reset_requested` on the user. Unknown emails get the same 202 and nothing happens.
  - The worker issues the token (stored as sha256, 30-minute TTL) and emails the link inside `processInTransaction`.
- **Check before hashing.**
  - `ResetPassword` first *peeks* at the token (no consume), so an invalid token never costs Argon2.
  - It then hashes outside the transaction, and finally consumes the token atomically and updates the user in one UoW.
- **Every password change bumps `tokenVersion`.** Phase 4/6 use that for session revocation. The change also raises `identity.user.password_changed`, which the worker turns into a notice email (no secrets in it).

**Tech Stack:**
- `@nestjs/mail@0.0.2`: installed, zero dependencies, SMTP + HTTP transports, `InMemoryMailTransport` for tests.
- Mailpit `axllent/mailpit` (SMTP 1025, HTTP 8025) in docker-compose and CI.
- Global `fetch` for HIBP with `AbortSignal.timeout`.

**Spec:**
- Roadmap Phase 3, remaining items.
- `CORNAL_AUTH_SYSTEM_DESIGN.md` §3.5 (forgot password always 202, single-use 30-minute token, reset revokes sessions + bumps `token_version`, password-changed email, HIBP k-anonymity fail-open).
- User decisions: SMTP for production; HIBP on, with a disable flag.

## Global Constraints

- Every rule from Phases 0–3a still applies. **No commits.**
- **Reset token:** 32 random bytes, base64url. Only sha256 is stored. TTL 30 minutes, single use. Requesting a new link revokes the open ones.
- **Forgot-password response:** always `202 { status: 'accepted' }`, whether the email exists or not. Rate limits: IP 10/hour, email 3/hour. Reset: IP 20 per 15 minutes.
- **HIBP check:**
  - Request: `GET https://api.pwnedpasswords.com/range/{first5}` with `Add-Padding: true` and `User-Agent: cornal-auth-srv`. Nothing else leaves the server.
  - Timeout 1000ms. Any failure counts as "not breached" (fail-open).
  - A padded entry with count 0 never matches.
  - Breached → 422 `IDENTITY.PASSWORD_BREACHED`.
- **Mail:**
  - `EMAIL_TRANSPORT = log | smtp` (`log` is still refused in production).
  - `SMTP_URL` is required when the transport is `smtp`.
  - `EMAIL_FROM` defaults to `Cornal <no-reply@cornal.local>`.
  - The library's own mail retry is off (`retry: false`): the outbox already retries the whole consumer.
- **Templates** use `html\`\`` from `@nestjs/mail` (auto-escaped), plus a plain-text alternative. No user-controlled value is inserted unescaped.
- **Change password while logged in** moves to Phase 4, because it needs `AccessTokenGuard` and step-up.

## Review Focus

1. **Forgot-password with an unknown email:** same 202 body, no outbox message, no email. Owner: Task 5.
2. **Reset with a token that was already used, or expired:** 400 `IDENTITY.INVALID_TOKEN`, and **no Argon2 run**. Owner: Task 4.
3. **Reset succeeds:**
   - The old password no longer verifies.
   - `token_version` goes up by 1.
   - Other open reset tokens are dead.
   - A `password-changed` email is sent.
   - A locked account is unlocked, and an unverified email becomes verified, since the reset link proves email ownership.

   Owner: Tasks 3–5.
4. **HIBP down or slow (more than 1s):** registration and reset still succeed (fail-open); nothing hangs. Owner: Task 2.
5. **Email template injection:** a link or address containing `<script>` is escaped in the HTML part. Owner: Task 1.

---

### Task 1: Email delivery through `@nestjs/mail` (SMTP + Mailpit)

**Files:**
- Create:
  - `src/modules/identity/infrastructure/email-templates.ts`
  - `src/modules/identity/infrastructure/mailer-email-sender.ts`
  - `src/shared/infrastructure/mail/mail.module.ts` (global; wraps `MailModule.forRootAsync`)
- Modify:
  - `src/config/env.schema.ts` + spec + `.env.example`: `EMAIL_TRANSPORT: log | smtp`, `SMTP_URL` (url, optional, required when smtp), `EMAIL_FROM`.
  - `src/modules/identity/application/ports.ts`: `EmailTemplate` adds `'password-reset' | 'password-changed'`; `data.link` stays.
  - `src/modules/identity/identity-core.module.ts`: `EMAIL_SENDER` → `MailerEmailSender`.
  - `docker-compose.yml`: add `mailpit`.
  - `.github/workflows/ci.yml`: add a `mailpit` service to the integration job.
  - `src/app.module.ts`: add `AppMailModule`.
- Delete: `src/modules/identity/infrastructure/log-email-sender.ts`
- Test:
  - `src/modules/identity/infrastructure/email-templates.spec.ts`
  - `test/integration/mailer-email-sender.int-spec.ts` (real SMTP → Mailpit; assertions read Mailpit's HTTP API)

**Interfaces:**
- `renderEmail(message: EmailMessage): { subject: string; html: SafeHtml; text: string }`, a pure function with one branch per template.
- `MailerEmailSender implements EmailSender`: `send(m)` → `mailer.send({ to: m.to, ...renderEmail(m) })`.
- `AppMailModule`: `MailModule.forRootAsync` with `{ transport: smtp ? new SmtpTransport({ url: SMTP_URL }) : new LogMailTransport(), from: EMAIL_FROM, retry: false }`.

- [ ] **Failing tests:**
  - templates:
    - `every template has a subject, html containing the link, and a text alternative`
    - `escapes markup in the link and recipient`
  - env:
    - `EMAIL_TRANSPORT smtp requires SMTP_URL`
    - `EMAIL_FROM has a default`
  - integration: `delivers verify-email over SMTP to Mailpit with subject and link`
- [ ] `docker compose up -d --wait mailpit`. Run, expect FAIL → implement → run, expect PASS.

### Task 2: Breached-password check (HIBP, k-anonymity, fail-open)

**Files:**
- Create: `src/modules/identity/infrastructure/hibp-breached-password-checker.ts`
- Modify:
  - `application/ports.ts`: add the `BREACHED_PASSWORD_CHECKER` port.
  - `domain/identity.errors.ts`: `PasswordBreachedError` → `IDENTITY.PASSWORD_BREACHED` (422).
  - `contracts/error-codes.ts`, `error-status.ts`
  - `application/register-user.use-case.ts` (checks after policy, before hashing)
  - env: `PASSWORD_BREACH_CHECK` (`'true'|'false'`, default true).
  - `identity-core.module.ts`
  - The e2e config sets `PASSWORD_BREACH_CHECK: false`, since tests never call the internet.
- Test: `hibp-breached-password-checker.spec.ts` (injected fake `fetch`), `register-user.use-case.spec.ts` (new case)

**Interfaces:**
- `BreachedPasswordChecker.isBreached(plain: string): Promise<boolean>`
- `HibpBreachedPasswordChecker(fetchFn: typeof fetch = fetch, timeoutMs = 1000)`
- `NeverBreachedChecker`, used when the check is disabled.

- [ ] **Failing tests:**
  - `sends only the 5-char SHA-1 prefix with Add-Padding and reports a listed suffix as breached`
  - `unlisted suffix → false`
  - `padded entry with count 0 → false`
  - `HTTP error → false (fail-open)`
  - `timeout → false within ~timeout`
  - register: `breached password → PasswordBreached, hasher not called`
- [ ] Run, expect FAIL → implement → run, expect PASS.

### Task 3: Domain + contracts for password reset

**Files:**
- Modify: `domain/user.ts`, `domain/user.spec.ts`, `contracts/identity.schemas.ts`
- Test: `user.spec.ts`

**Interfaces:**
- `User.requestPasswordReset(now)` raises `identity.user.password_reset_requested`.
- `User.resetPassword(newHash, now)`:
  - sets `passwordHash`;
  - `tokenVersion += 1`;
  - clears the lock (`status` → `active`, `lockedUntil` → null);
  - verifies the email if it is not verified yet;
  - raises `identity.user.password_changed { reason: 'reset' }`.
- Schemas:
  - `ForgotPasswordRequestSchema { email: string ≤254 }`
  - `ResetPasswordRequestSchema { token: /^[A-Za-z0-9_-]{43}$/, password: 1..256 }`
  - `AcceptedResponse { status: 'accepted' }`, shared with register.

- [ ] **Failing tests:**
  - `requestPasswordReset raises password_reset_requested`
  - `resetPassword replaces hash, bumps tokenVersion, unlocks, verifies email, raises password_changed`
- [ ] Run, expect FAIL → implement → run, expect PASS.

### Task 4: Use cases — token link issuing, request/issue/reset, password-changed notice

**Files:**
- Create in `application/`:
  - `issue-token-link.ts`: a shared helper extracted from `IssueEmailVerificationUseCase`.
  - `request-password-reset.use-case.ts`
  - `issue-password-reset.use-case.ts`
  - `reset-password.use-case.ts`
  - `notify-password-changed.use-case.ts`
- Modify:
  - `issue-email-verification.use-case.ts`: uses the helper; its tests must stay green.
  - `ports.ts`: `OneTimeTokenRepository.findValid(purpose, hash, now): Promise<{ userId } | undefined>` (read-only).
  - `infrastructure/typeorm-one-time-token.repository.ts`
- Test: the spec for each use case, plus `test/integration/identity-repositories.int-spec.ts` (`findValid` does not consume).

**Interfaces:**
- `issueTokenLink(deps, { user, purpose, ttlMs, template, baseUrl })`: `revokeOpen` → `issue` → send the email with `?token=`.
- `RequestPasswordResetUseCase.execute({ email }): Promise<Result<{ status: 'accepted' }, never>>`. An invalid email format or an unknown user gives the same answer and writes nothing.
- `IssuePasswordResetUseCase.execute({ userId }): Result<'sent' | 'user_missing'>`. TTL 30 minutes, template `password-reset`, URL `PASSWORD_RESET_URL`.
- `ResetPasswordUseCase.execute({ token, password }): Result<void, InvalidTokenError | WeakPasswordError | PasswordBreachedError | ServiceBusyError>`. Order:
  1. Policy.
  2. `findValid` → `InvalidToken`.
  3. Breach check.
  4. Hash (outside the UoW).
  5. `uow`: `consume`, then if it fails (race) → `InvalidToken`.
  6. Load the user → `resetPassword` → `revokeOpen('password_reset')` → save.
- `NotifyPasswordChangedUseCase.execute({ userId })` → template `password-changed`, link = `APP_LOGIN_URL`.

- [ ] **Failing tests:**
  - request:
    - `existing user → event recorded, accepted`
    - `unknown or malformed email → accepted, nothing saved`
  - issue-reset: `issues a 30-min password_reset token and emails the reset link`
  - reset:
    - `valid token → new hash, tokenVersion+1, token consumed, other reset tokens revoked`
    - `unknown token → InvalidToken and hasher not called`
    - `breached → PasswordBreached, token not consumed`
    - `weak → WeakPassword`
    - `busy hasher → ServiceBusyError, token not consumed`
  - notify: `sends password-changed to the owner`
  - integration: `findValid returns the owner without consuming`
- [ ] Run, expect FAIL → implement → run, expect PASS.

### Task 5: Wiring — endpoints, throttles, consumers, e2e

**Files:**
- Modify:
  - `presentation/identity.controller.ts`: `POST /auth/password/forgot` → 202, `POST /auth/password/reset` → 204.
  - `shared/infrastructure/throttling/rate-limits.ts`: `forgotPassword`, `resetPassword`.
  - `infrastructure/identity-email.consumer.ts`: `password_reset_requested` → consumer `password-reset-link`; `password_changed` → consumer `password-changed-notice`.
  - `identity-core.module.ts`
  - env + spec + `.env.example`: `PASSWORD_RESET_URL` (default `http://localhost:3000/reset-password`).
- Test: `test/e2e/password-reset.e2e-spec.ts`

- [ ] **Failing e2e**, with the app role `login` + IdentityWorkerModule + a capturing `EMAIL_SENDER`, and a fake breach checker override where needed:
  - `forgot with unknown email → 202 accepted, no email after relay`
  - `full reset: forgot → relay → reset link → reset 204 → old password rejected, new accepted (VerifyCredentialsUseCase) → password-changed email`
  - `reusing the reset token → 400 IDENTITY.INVALID_TOKEN`
  - `breached new password → 422 IDENTITY.PASSWORD_BREACHED`
  - `4th forgot for the same email within the hour → 429`
- [ ] Run `pnpm test:e2e`. Expected: FAIL → implement → PASS.

### Gate (no commit)

- [ ] `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm test:e2e && pnpm test:int && pnpm build` → exit 0, and e2e passes on two consecutive runs.
- [ ] Manual check with `.env` using `EMAIL_TRANSPORT=smtp` and Mailpit, `login` + `worker`:
  1. Register → the verify email appears in Mailpit.
  2. Forgot → the reset email appears in Mailpit.
  3. Reset through `curl` → the password-changed email appears.
  4. Check via `http://localhost:8025/api/v1/messages`.
- [ ] Update the roadmap (3b done; "change password" moves to Phase 4). Report, and wait for the commit.
