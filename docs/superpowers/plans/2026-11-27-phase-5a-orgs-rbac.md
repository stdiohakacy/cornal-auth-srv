# Phase 5a — Organizations, Permission Catalog, Org-scoped Tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- A verified user can create an organization and becomes its owner.
- Access tokens carry the active organization with a compact permission bitset (`pbits`).
- Users can switch organizations without logging in again.
- Org-scoped routes enforce "token org = route org" plus a required permission.

**Architecture:**
- **New `organization` module** owns `Organization` and `Membership` (role assignments are a `WatchedList` inside `Membership`).
- **New `access-control` module** owns the permission catalog, the system roles, the pbits encoding (`src/sdk/permission-bits.ts`, verified code from SD §3.4) and `PermissionsGuard`.
- **The catalog lives in code** (`src/contracts/permissions.ts`, user decision): fixed bit indices, append-only, enforced by a lock test. It is synced into `permissions` / system `roles` / `role_permissions` at boot (idempotent; a mismatched bit fails startup).
- **Session gains `activeOrgId`.**
  - Login picks the most recently used org whose membership is still active; with no such org but exactly one active membership, it picks that one.
  - Refresh recomputes the org context, so role changes reach the token within one refresh.
  - `POST /auth/session/organization` switches without a new refresh token.
- **Module boundary.** Session talks to organization only through an exported façade (`ResolveOrgContextUseCase`). Organization reads emails through an identity façade.

**Tech Stack:** no new dependencies.

**Spec:**
- Roadmap Phase 5 (split by user decision: 5b = invitations, custom-role CRUD, assign/unassign, suspend).
- `CORNAL_AUTH_SYSTEM_DESIGN.md` §2.2 (`organizations`, `memberships`, `roles`, `permissions`, `role_permissions`, `membership_roles`, `sessions.active_org_id`), §3.2 (PermissionsGuard + org match), §3.4 (claims, pbits, switch org), §5.3 (catalog ≤ 2,000 bits).

## Global Constraints

- Every rule from earlier phases still applies. **No commits.**
- **Catalog:** codes match `^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$`. Bit indices are unique and never reused or changed. `PERMISSION_CATALOG_VERSION` (`pcv`) is bumped when entries are added. Initial catalog (bits 0–7):

  | Bit | Code |
  |---|---|
  | 0 | `org:read` |
  | 1 | `org:manage` |
  | 2 | `member:read` |
  | 3 | `member:invite` |
  | 4 | `member:manage` |
  | 5 | `role:read` |
  | 6 | `role:manage` |
  | 7 | `audit:read` |

- **System roles** (`org_id NULL`):
  - `owner` = all permissions.
  - `admin` = all except `org:manage`.
  - `member` = `org:read`, `member:read`, `role:read`.
- **Access token org claims** (present only when an org is active):

  | Claim | Meaning |
  |---|---|
  | `org` | organization id |
  | `mid` | membership id |
  | `mv` | `membership.authz_version` |
  | `ov` | `organization.authz_epoch` |
  | `pcv` | permission-catalog version |
  | `pbits` | base64url permission bitset |

- **Org rules:**
  - Slug: `^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$`, unique.
  - Name: 1–100 characters.
  - Only users with a verified email may create an organization.
- **Errors:**

  | Code | HTTP |
  |---|---|
  | `ORG.SLUG_TAKEN` | 409 |
  | `ORG.NOT_MEMBER` | 403 |
  | `ORG.MFA_REQUIRED` | 403 |
  | `ORG.EMAIL_NOT_VERIFIED` | 403 |
  | `ACCESS.FORBIDDEN` | 403 |
  | `ACCESS.ORG_MISMATCH` | 403 |

- **Org-scoped routes** are `/iam/orgs/:orgId/...`, guarded by AccessTokenGuard then PermissionsGuard. The org check comes before the permission check.
- **Not in 5a** (recorded as deferred): the Redis pbits cache (DB query per token issue is indexed and cheap at current scale), invitations, custom roles, suspend.

## Review Focus

1. **A token for org A calling `/iam/orgs/B/members`** → 403 `ACCESS.ORG_MISMATCH`, even if the user also belongs to B. They must switch first. Owner: Task 7.
2. **A plain `member` calling a route that requires `member:manage`** → 403 `ACCESS.FORBIDDEN`. An `owner` → 200. Owner: Task 7.
3. **Switching to an org the user does not belong to** → 403 `ORG.NOT_MEMBER`, and the session's active org is unchanged. Owner: Task 6.
4. **Catalog drift:** changing an existing code's bit in code, or the DB holding a different bit for a code → the unit lock test fails, and startup fails. Owner: Tasks 1 and 2.
5. **A user who belongs to exactly one org logs in** → the token carries that org. A user with several orgs → the one used most recently. Owner: Task 6.

---

### Task 1: Contracts — catalog, system roles, errors, schemas; SDK pbits

**Files:**
- Create:
  - `src/contracts/permissions.ts` + `permissions.spec.ts` (lock test)
  - `src/contracts/organization.schemas.ts`
  - `src/sdk/permission-bits.ts` + spec (verified SD §3.4 code + tests)
- Modify: `src/contracts/error-codes.ts`, `error-status.ts`

**Interfaces:**
- `PERMISSIONS: readonly { code; bit; description }[]`, `type Permission`, `PERMISSION_CATALOG_VERSION = 1`
- `SYSTEM_ROLES: Record<'owner' | 'admin' | 'member', readonly Permission[]>`
- `permissionCatalog(): PermissionCatalog`
- SDK: `encodePermissionBits`, `decodePermissionBits`, `hasPermission`
- Schemas:
  - `CreateOrganizationRequest { name, slug }`
  - `OrganizationResponse { id, slug, name, roles: string[] }`
  - `MemberListResponse`
  - `SwitchOrganizationRequest { orgId: uuid }`
  - `OrgIdParamSchema` (uuid)

- [ ] **Failing tests:**
  - `codes and bits are unique and well-formed`
  - `existing code→bit pairs never change (lock)`
  - `system roles only reference catalog codes; owner has all`
  - pbits (SD §3.4 tests):
    - `round-trips and stays compact for 500 permissions`
    - `unknown code → false`
- [ ] Run, expect FAIL → implement → run, expect PASS.

### Task 2: Catalog sync at boot

**Files:**
- Create:
  - `src/modules/access-control/infrastructure/catalog-sync.ts`
  - `src/modules/access-control/access-control-core.module.ts` (onModuleInit → sync)
- Test: `test/integration/catalog-sync.int-spec.ts`

**Interfaces:**
- `syncPermissionCatalog(manager): Promise<void>`, inside one transaction:
  1. Upsert `permissions` (`ON CONFLICT (code) DO UPDATE SET description`). If an existing row's `bit_index` differs → throw `InvariantViolation`.
  2. Upsert system roles by `(NULL, key)`.
  3. Replace each system role's `role_permissions` with the catalog's set.
- Exposes `SystemRoleIds` lookup `{ owner, admin, member }` (UUIDs read back after the sync).

- [ ] **Failing tests:**
  - `sync is idempotent (twice → same rows)`
  - `system roles get exactly their permissions`
  - `a DB bit that differs from code → throws`
- [ ] Run, expect FAIL → implement → run, expect PASS.

### Task 3: Organization domain

**Files:**
- Create in `src/modules/organization/domain/`:
  - `organization.ts`, `membership.ts`, `slug.ts`, `organization.errors.ts` + specs

**Interfaces:**
- `Slug.create(raw): Result<Slug, InvalidSlugError>` (lowercased; an invalid slug → 422 `ORG.INVALID_SLUG`, an extra code).
- `Organization.create({ name, slug, now })` raises `organization.created`. Props: `slug`, `name`, `status`, `authzEpoch`, `mfaRequired`, `createdAt`.
- `Membership`:
  - `Membership.createOwner({ orgId, userId, ownerRoleId, now })`: an active membership with roles `[ownerRoleId]`, raising `organization.member_added`.
  - `roles: RoleSet` (a `WatchedList<RoleId>`), `authzVersion`, `isActive`.

- [ ] **Failing tests:**
  - `slug normalizes case and rejects bad shapes`
  - `create org raises organization.created`
  - `owner membership has the owner role and is active`
- [ ] Run, expect FAIL → implement → run, expect PASS.

### Task 4: Organization persistence + read queries

**Files:**
- Create in `src/modules/organization/infrastructure/`:
  - `typeorm-organization.repository.ts`, `typeorm-membership.repository.ts`, `organization-queries.ts`
- Test: `test/integration/organization-repositories.int-spec.ts`

**Interfaces:**
- `OrganizationRepository.save(org)`; `findById`. Unique slug → `SlugTakenError`.
- `MembershipRepository.save(m)`: inserts the membership plus a `membership_roles` diff (added/removed); optimistic version. `findByOrgAndUser(orgId, userId)`.
- `OrganizationQueries`:
  - `membershipContext(userId, orgId): Promise<{ membershipId, authzVersion, authzEpoch, mfaRequired, permissions: string[] } | undefined>`. Active membership and active org only; permissions are the union over the membership's roles.
  - `activeMembershipsOf(userId): Promise<{ orgId, slug, name, roleKeys }[]>`
  - `membersOf(orgId): Promise<{ membershipId, userId, status, roleKeys }[]>`

- [ ] **Failing tests:**
  - `org + owner membership round-trip`
  - `duplicate slug → SlugTakenError`
  - `membershipContext unions role permissions; suspended membership → undefined`
  - `activeMembershipsOf lists orgs with role keys`
- [ ] Run, expect FAIL → implement → run, expect PASS.

### Task 5: Organization use cases + façades

**Files:**
- Create in `src/modules/organization/application/`:
  - `create-organization.use-case.ts`, `list-my-organizations.use-case.ts`, `list-members.use-case.ts`, `resolve-org-context.use-case.ts` + specs, `ports.ts`
- Modify (identity): `GetUserAuthStateUseCase` adds `emailVerified`. New `GetUserEmailsUseCase(ids) → Map<id, email>`. Both are exported.

**Interfaces:**
- `CreateOrganizationUseCase.execute({ userId, name, slug }): Result<{ orgId }, EmailNotVerifiedError | InvalidSlugError | SlugTakenError>`. One UoW: org + owner membership.
- `ResolveOrgContextUseCase.execute({ userId, orgId }): Promise<OrgContext | undefined>`, where `OrgContext = { orgId, membershipId, mv, ov, pcv, pbits, mfaRequired }` (encodes pbits with the catalog).
- `ResolveOrgContextUseCase.defaultOrgFor({ userId, preferredOrgId? })`: the preferred org if still active, else the single active membership if there is exactly one, else undefined.
- `ListMembersUseCase` joins emails via the identity façade.

- [ ] **Failing tests:**
  - `create requires verified email`
  - `create → org + owner membership`
  - `slug taken passes through`
  - `resolve encodes owner permissions into pbits`
  - `default org: preferred active > single membership > none`
  - `list members includes emails`
- [ ] Run, expect FAIL → implement → run, expect PASS.

### Task 6: Session integration — activeOrgId, org claims, login/refresh/switch

**Files:**
- Modify:
  - `session/domain/session.ts` (`activeOrgId` + `switchOrganization(orgId | null)`), repository (`active_org_id`), `lastActiveOrgOf(userId)`
  - `application/ports.ts` (`AccessClaims.org?`, `ORG_CONTEXT` port), login/refresh use cases
  - `jose-token-service.ts` (org claims in and out)
- Create: `application/switch-organization.use-case.ts` (+ spec); endpoint `POST /auth/session/organization`
- Test: unit + `test/e2e/organizations.e2e-spec.ts` (switch cases)

**Interfaces:**
- `OrgContextReader` port: `contextFor(userId, orgId)` and `defaultFor(userId, preferredOrgId?)`. In session-core it is adapted from `ResolveOrgContextUseCase`.
- Login: preferred = `sessions.lastActiveOrgOf(userId)`.
- Refresh: recompute the context for `session.activeOrgId`. If none → clear it.
- `SwitchOrganizationUseCase.execute({ sessionId, userId, orgId, amr }): Result<{ accessToken, expiresIn }, OrgNotMemberError | OrgMfaRequiredError | SessionInvalidError>`.
  - `mfaRequired` without `otp` in `amr` → MfaRequired.
  - Session not active → SessionInvalid.

- [ ] **Failing tests:**
  - token: `org claims round-trip; absent when no org`
  - switch:
    - `member → new token with that org and pbits, session remembers it`
    - `non-member → NotMember and session unchanged`
    - `mfa_required org without otp → MfaRequired`
  - login: `single membership → org in token`
  - refresh: `recomputes pbits`
- [ ] Run, expect FAIL → implement → run, expect PASS.

### Task 7: Access guard + HTTP routes + catalog endpoint

**Files:**
- Create in `src/modules/access-control/presentation/`:
  - `permissions.guard.ts`, `require-permissions.decorator.ts`
- Create in `src/modules/organization/presentation/`:
  - `organizations.controller.ts` (`POST /iam/orgs`, `GET /iam/me/organizations`, `GET /iam/orgs/:orgId/members`)
  - modules `organization-core/api`
- Create: `GET /.well-known/permission-catalog.json` (`ETag: "pcv-<n>"`)
- Modify: `app.module.ts` (`api` → + OrganizationApiModule; every role → AccessControlCoreModule for the sync)
- Test: `test/e2e/organizations.e2e-spec.ts`

**Interfaces:**
- `@RequirePermissions(...codes: Permission[])`
- `PermissionsGuard`:
  1. Reads `request.auth.org`; missing → `ACCESS.FORBIDDEN`.
  2. `:orgId` ≠ `org` → `ACCESS.ORG_MISMATCH`.
  3. Every required code must be set in `pbits` → else `ACCESS.FORBIDDEN`.

- [ ] **Failing e2e:**
  - `unverified user cannot create an org → 403 ORG.EMAIL_NOT_VERIFIED`
  - `verified user creates an org → 201; GET /iam/me/organizations lists it with role owner`
  - `after switching, the token carries org/mid/pbits and the owner lists members`
  - `token for org A on /iam/orgs/B/members → 403 ACCESS.ORG_MISMATCH`
  - `member without member:manage → 403 ACCESS.FORBIDDEN on a guarded route`. Use a test-only controller requiring `member:manage`, with the member added by SQL in the test until 5b brings invitations.
  - `switch to a foreign org → 403 ORG.NOT_MEMBER`
  - `user with one org gets it in the login token`
  - `permission catalog endpoint serves version and ETag`
- [ ] Run, expect FAIL → implement → run, expect PASS.

### Gate (no commit)

- [ ] `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm test:e2e && pnpm test:int && pnpm build` → exit 0, with e2e green on two runs.
- [ ] Manual check: login + api.
  1. Register, verify, login.
  2. Create an org.
  3. Switch.
  4. Decode the token claims.
  5. List members.
- [ ] Update the roadmap (5a done). Report, and wait for the commit.
