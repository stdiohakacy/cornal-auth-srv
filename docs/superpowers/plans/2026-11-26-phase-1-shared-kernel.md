# Phase 1 — Shared Kernel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the framework-free domain kernel and the HTTP cross-cutting layer every module relies on:
- `Result`, `DomainError`, aggregates, value objects and events, plus ports.
- An error-code catalog.
- Request context on native ALS.
- One RFC 9457 exception filter.
- A fail-closed Standard Schema validation pipe.
- Redacted pino logging.

**Architecture:**
- **Domain kernel:** `src/shared/domain` holds pure TypeScript, copied verbatim from the verified code in the Playbook §2 and now covered by unit specs. The ports live in `src/shared/application`.
- **HTTP layer:**
  - `src/shared/infrastructure/http/configure-http.ts` is the single place that applies trust-proxy, request context, the global pipe and the global filter.
  - Both `main.ts` and the e2e tests call it, so tests run the real HTTP setup.
  - The request-context middleware is registered with `app.use()` before `init()`. Everything after it, pino-http included, therefore runs inside the ALS scope.

**Tech Stack:** NestJS 12.4 (`StandardSchemaValidationPipe` is built in), `zod@4.6.7`, `nestjs-pino@5.3.1`, `pino@10.4.0`, `pino-http@11.0.0` (all pass the 14-day `minimumReleaseAge`), `node:async_hooks`, Vitest 4.

**Spec:**
- `2026-11-26-cornal-auth-roadmap.md`, Phase 1.
- `../../../../CORNAL_AUTH_ARCHITECTURE_PLAYBOOK.md`, §2 (kernel code, copied verbatim) and §3.3, §4.2.
- `../../../../CORNAL_AUTH_SYSTEM_DESIGN.md`, §3.2.

## Global Constraints

- Same as Phase 0: ESM `.js` imports, no barrels, no `any` and no `!`, every dependency at least 14 days old, **no commits** (the user commits).
- `domain/` and `application/` must not import `@nestjs/*`. oxlint enforces this for `src/**/domain/**` and `src/**/application/**`.
- Error codes are strings of the form `NAMESPACE.UPPER_SNAKE`. The HTTP status for each code lives in **one** table that is checked by `satisfies Record<ErrorCode, number>`.
- A 5xx response never includes the original error message. Every error response carries `requestId`.

## Review Focus

1. **Client-supplied `x-request-id` that is oversized or contains spaces or newlines** → replaced with a server-generated UUIDv7, never echoed back. Owner: Task 4.
2. **`X-Forwarded-For` spoofing:** with `TRUST_PROXY=false`, the logged and stored IP is the socket address, not the header. Owner: Task 4.
3. **A route parameter with no schema** (`@Body() body: unknown`) → 500 `COMMON.INTERNAL` (fail closed); the handler never runs. Owner: Task 5.
4. **Readiness 503 body:** keeps the terminus shape (`status`, `info`, `error`). The global filter must not rewrite it, otherwise orchestrators and the Phase 0 tests break. Owner: Task 5.
5. **Secrets in logs:** `authorization`, `cookie`, `set-cookie` and the fields `password`, `token`, `refreshToken`, `code` appear as `[Redacted]`. Owner: Task 6.

---

### Task 1: Domain kernel + ports

**Files:**
- Create (verbatim from the Playbook code blocks headed `// src/shared/...`):
  - `src/shared/domain/{id,result,domain-error,guard,value-object,domain-event,entity,aggregate-root,watched-list}.ts`
  - `src/shared/application/ports.ts`
- Test: `src/shared/domain/{result,guard,value-object,aggregate-root,watched-list,id}.spec.ts`

**Interfaces:**
- Produces exactly the Playbook §2 API:
  - `ok`, `err`, `map`, `combine`, `Result<T,E>`
  - `DomainError<C>`, `InvariantViolation`
  - `invariant`, `assertNever`, `first`, `last`, `single`, `lookup`
  - `newId<B>()`, `parseId<B>()`, `Id<B>`
  - `ValueObject`, `Entity`, `AggregateRoot` (`raise`, `pullEvents`, `pendingEvents`, `version`, `markPersisted`), `EventSource`
  - `createEvent`, `DomainEvent`
  - `WatchedList` (`items`, `added`, `removed`, `add`, `remove`, `has`)
  - `RepositoryPort`, `Mapper`, `UNIT_OF_WORK`/`UnitOfWork`, `CLOCK`/`Clock`

- [ ] **Write the failing specs.** Each spec uses a tiny local subclass where it needs one.
  - `result.spec.ts`:
    - `combine returns all values in order`
    - `combine returns the first error`
    - `map leaves an err untouched`
  - `guard.spec.ts`:
    - `single throws InvariantViolation on 0 or 2 items`
    - `lookup ignores inherited keys` (`lookup({}, 'toString')` → `undefined`)
    - `invariant narrows and throws with the message`
  - `value-object.spec.ts`:
    - `equal props → equals true`
    - `different subclass with same props → false`
    - `props are frozen`
  - `aggregate-root.spec.ts`:
    - `pullEvents returns raised events once then empty`
    - `markPersisted increments version`
  - `watched-list.spec.ts`:
    - `remove then add an initial item leaves added/removed empty`
    - `add then remove a new item leaves added empty`
    - `remove an initial item lists it in removed`
  - `id.spec.ts`:
    - `newId is a UUIDv7`: matches `/^[0-9a-f]{8}-[0-9a-f]{4}-7/`
    - `parseId rejects non-uuid`
- [ ] Run `pnpm test src/shared`. Expected: FAIL (modules not found).
- [ ] Extract the 10 files from the Playbook with a script that copies each code block headed `// src/shared/domain/*` or `// src/shared/application/ports.ts` verbatim.
- [ ] Run `pnpm test src/shared` and `pnpm lint`. Expected: PASS, 0 lint errors.

### Task 2: Config uses the shared `Result`; new env fields

**Files:**
- Modify: `src/config/env.schema.ts`, `src/config/env.schema.spec.ts`, `.env.example`

**Interfaces:**
- `parseConfig(env) → Result<AppConfig, string>`. The local `ConfigResult` type is removed.
- New fields:
  - `LOG_LEVEL` gains `'silent'`.
  - `TRUST_PROXY`: string, default `'loopback'`, transformed to `boolean | number | string`. `'true'` → `true`, `'false'` → `false`, digits → number, anything else stays a string (Express trust-proxy syntax).

- [ ] **Failing tests:**
  - `TRUST_PROXY defaults to "loopback"`
  - `TRUST_PROXY "false" becomes false`
  - `TRUST_PROXY "2" becomes 2`
  - `LOG_LEVEL accepts silent`
- [ ] Run `pnpm test src/config`. Expected: FAIL.
- [ ] Implement the change. Swap to `ok`/`err` from `../shared/domain/result.js`. Add `TRUST_PROXY=loopback` to `.env.example`.
- [ ] Run `pnpm test src/config`. Expected: PASS.

### Task 3: Error-code catalog + status map + unwrap

**Files:**
- Create: `src/contracts/error-codes.ts`, `src/shared/infrastructure/http/error-status.ts`, `src/shared/infrastructure/http/unwrap.ts`
- Test: `src/shared/infrastructure/http/unwrap.spec.ts`

**Interfaces:**
- `CommonErrorCode` (an `as const` object) with these entries:

  | Key | Code |
  |---|---|
  | `ValidationFailed` | `'COMMON.VALIDATION_FAILED'` |
  | `BadRequest` | `'COMMON.BAD_REQUEST'` |
  | `Unauthenticated` | `'COMMON.UNAUTHENTICATED'` |
  | `Forbidden` | `'COMMON.FORBIDDEN'` |
  | `NotFound` | `'COMMON.NOT_FOUND'` |
  | `Conflict` | `'COMMON.CONFLICT'` |
  | `ConcurrencyConflict` | `'COMMON.CONCURRENCY_CONFLICT'` |
  | `RateLimited` | `'COMMON.RATE_LIMITED'` |
  | `ServiceUnavailable` | `'COMMON.SERVICE_UNAVAILABLE'` |
  | `Internal` | `'COMMON.INTERNAL'` |

- `type ErrorCode` = the union of every catalog's values. In Phase 1 that is `CommonErrorCode` only; later modules add their own objects into this union.
- `ERROR_STATUS: Record<ErrorCode, HttpStatus>` (via `satisfies`): 422, 400, 401, 403, 404, 409, 409, 429, 503, 500.
- `unwrap<T>(r: Result<T, DomainError>): T`, which throws the `DomainError` on `err`.
- `httpStatusToCode(status: number): ErrorCode`: exact mapping for 400, 401, 403, 404, 409, 429, 503; any other 4xx → `COMMON.BAD_REQUEST`; any other 5xx → `COMMON.INTERNAL`.

- [ ] **Failing tests:**
  - `unwrap returns the value of ok`
  - `unwrap throws the same DomainError instance on err`
  - `httpStatusToCode maps 404 to COMMON.NOT_FOUND`
  - `httpStatusToCode maps 418 to COMMON.BAD_REQUEST`
  - `httpStatusToCode maps 502 to COMMON.INTERNAL`
- [ ] Run, expect FAIL → implement → run, expect PASS.

### Task 4: Request context (ALS) + `configureHttp`

**Files:**
- Create:
  - `src/shared/infrastructure/request-context/request-context.ts`
  - `src/shared/infrastructure/request-context/request-context.middleware.ts`
  - `src/shared/infrastructure/request-context/request-context.module.ts` (global, provides `RequestContext`)
  - `src/shared/infrastructure/http/configure-http.ts`
- Modify: `src/main.ts`, `src/app.module.ts`
- Test: `test/e2e/request-context.e2e-spec.ts`; shared e2e helper `test/e2e/support/create-app.ts`

**Interfaces:**
- `RequestContext`, from Playbook §3.3:
  - `run(meta, fn)`
  - `current(): RequestMeta | undefined`
  - `RequestMeta = { requestId; ip; userAgent; actorId }`
- `configureHttp(app: NestExpressApplication, config: AppConfig): void`. It does the following, in order:
  1. `app.set('trust proxy', config.TRUST_PROXY)`
  2. `app.use(requestContextMiddleware(ctx))`
  3. `app.useGlobalPipes(...)`, added in Task 5
  4. `app.useGlobalFilters(...)`, added in Task 5
- `createTestApp(overrides?: Partial<AppConfig>, extra?: { controllers?: Type[] }): Promise<NestExpressApplication>` in `test/e2e/support/create-app.ts`. It builds `AppModule.forRole`, calls `configureHttp`, then `init()`. The health e2e test switches to this helper.
- The request id is UUIDv7. An incoming `x-request-id` is accepted only if it matches `^[\w-]{8,64}$`. The id is echoed in the `x-request-id` response header.

- [ ] **Failing e2e tests.** A test-only `@Controller('__ctx')` returns `ctx.current()`.
  - `generates a UUIDv7 request id and echoes it in the header`
  - `keeps a valid incoming x-request-id`
  - `replaces an invalid incoming x-request-id`: input `'bad id\n'`, and `'a'.repeat(65)`
  - `TRUST_PROXY loopback uses X-Forwarded-For`: `ip` = `'203.0.113.7'`
  - `TRUST_PROXY false ignores X-Forwarded-For`: `ip` ≠ `'203.0.113.7'`
- [ ] Run `pnpm test:e2e`. Expected: FAIL.
- [ ] Implement it. `main.ts` uses `NestFactory.create<NestExpressApplication>(…, { bufferLogs: true })` and then calls `configureHttp`.
- [ ] Run `pnpm test:e2e`. Expected: PASS, with the 4 health tests still green.

### Task 5: `AppExceptionFilter` (RFC 9457) + fail-closed validation pipe

**Files:**
- Create:
  - `src/shared/infrastructure/http/app-exception.filter.ts`
  - `src/shared/infrastructure/http/request-validation.ts` (`RequestValidationError` + `FailClosedValidationPipe`)
- Modify: `configure-http.ts`, `src/health/health.controller.ts` (readiness returns the terminus body with 503 itself)
- Test: `test/e2e/errors.e2e-spec.ts`

**Interfaces:**
- The problem body uses `Content-Type: application/problem+json` and these fields:

  | Field | Value |
  |---|---|
  | `type` | `'about:blank'` |
  | `title` | HTTP reason phrase |
  | `status` | HTTP status |
  | `code` | an `ErrorCode` |
  | `detail` | message |
  | `instance` | request path |
  | `requestId` | the request id |
  | `errors?` | `{ path: string; message: string }[]` |

- How each exception is mapped:
  - `DomainError` → `ERROR_STATUS[code]`, `detail = message`. A code outside the catalog → 500. `details` are included only if present.
  - `RequestValidationError` → 422 `COMMON.VALIDATION_FAILED` with `errors`. `path` is the issue path joined with `.`.
  - `HttpException` → its status, `httpStatusToCode(status)`, `detail` = message for 4xx and `'Internal server error'` for 5xx.
  - Anything else → 500 `COMMON.INTERNAL`, `detail: 'Internal server error'`, logged with its stack at `error` level.
- `FailClosedValidationPipe extends StandardSchemaValidationPipe`: if `metadata.type` is in `body | query | param` and `metadata.schema` is missing, it throws `InvariantViolation('Missing schema for <type> parameter')`, which surfaces as 500. Its `exceptionFactory` returns `new RequestValidationError(issues)`.

- [ ] **Failing e2e tests.** These use test-only controllers.
  - `unknown error → 500 problem+json with requestId and no original message`. The handler throws `new Error('db password=hunter2')`; assert the body does not contain `hunter2`.
  - `DomainError → mapped status and code`: a `TestConflictError` with code `COMMON.CONFLICT` → 409.
  - `invalid body → 422 with field errors`: schema `z.strictObject({ email: z.email() })` with body `{ email: 'x' }` → `errors[0].path === 'email'`.
  - `route without schema → 500 and handler not executed`
  - `unknown route → 404 COMMON.NOT_FOUND`
  - Existing: `readiness 503 keeps terminus body` (the Phase 0 test must still pass).
- [ ] Run `pnpm test:e2e`. Expected: FAIL.
- [ ] Implement the filter and the pipe. `HealthController.ready` catches `ServiceUnavailableException`, sets the status to 503 through `@Res({ passthrough: true })`, and returns `exception.getResponse()`.
- [ ] Run `pnpm test:e2e`. Expected: PASS.

### Task 6: Logger (nestjs-pino) with redaction

**Files:**
- Create: `src/shared/infrastructure/logging/logger.options.ts`, `src/shared/infrastructure/logging/logging.module.ts`
- Modify: `src/app.module.ts`, `src/main.ts` (`app.useLogger(app.get(Logger))`), `AppExceptionFilter` (uses Nest's `Logger`)
- Test: `src/shared/infrastructure/logging/logger.options.spec.ts`

**Interfaces:**
- `REDACT_PATHS: readonly string[]`:
  - `req.headers.authorization`, `req.headers.cookie`, `res.headers["set-cookie"]`
  - `*.password`, `*.token`, `*.refreshToken`, `*.code`
- `buildPinoHttpOptions(config: AppConfig, ctx: RequestContext): Options` sets:
  - `level` = `LOG_LEVEL`
  - `redact: { paths: REDACT_PATHS, censor: '[Redacted]' }`
  - `genReqId` → `ctx.current()?.requestId` (falls back to `randomUUIDv7()`)
  - `customProps` → `{ requestId }`
  - `autoLogging.ignore` for `/health`

- [ ] **Failing tests:** create a pino logger from `buildPinoHttpOptions(...)` that writes to an in-memory stream.
  - `redacts authorization and cookie headers`
  - `redacts nested password and refreshToken`
  - `uses LOG_LEVEL`
- [ ] Run, expect FAIL → `pnpm add nestjs-pino@5.3.1 pino@10.4.0 pino-http@11.0.0` → implement → run, expect PASS.
- [ ] Set `LOG_LEVEL: 'silent'` in the e2e helper's default config so test output stays clean.

### Gate (no commit)

- [ ] `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm test:e2e && pnpm test:int && pnpm build` → exit 0.
- [ ] Manual check: `pnpm build`, boot with a valid env, then `curl -i localhost:<port>/nope`. Expect 404 `application/problem+json` with `x-request-id`, and a JSON log line that carries the same `requestId`.
- [ ] Report to the user and wait for their commit.
