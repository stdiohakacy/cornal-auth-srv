# Phase 5b — Invitations, custom roles, member management — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (chosen for this project: inline, one session) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Org admins invite people by email, manage custom roles, change a member's roles or status, and remove members, without privilege escalation and without ever leaving an org ownerless.

**Architecture:**
- Organization owns roles (aggregate `Role`), memberships and the invitation *request*.
- Invitation tokens live in identity's `one_time_tokens(purpose='org_invite')`, reached only through identity façades. The API raises `organization.invitation.created`; the worker mints the token, stores its sha256 and sends the email. The raw secret never enters the outbox.
- Accepting requires a signed-in user whose verified email equals the invited email.
- Every authorization change bumps a version (`memberships.authz_version` or `organizations.authz_epoch`). Phase 6 turns those bumps into revocations; refresh already recomputes `pbits`.

**Tech Stack:** NestJS 12 ESM, TypeORM (hand-written SQL), `@nestjs/outbox`, Zod 4, Vitest 4.

**Spec:** `../CORNAL_AUTH_SYSTEM_DESIGN.md` (SD§2 DDL, SD§3.2/3.4, SD§4 sequence "admin changes a member"), roadmap `2026-11-26-cornal-auth-roadmap.md` Phase 5. User decisions (2026-11-27):
- Invitations are stored in `one_time_tokens(org_invite)`.
- Accepting needs a login, and the invited email must match the user's verified email.
- `StepUpGuard` is deferred to the MFA phase.

## Global Constraints

- Layering per `.claude/rules/architecture.md`: application has no `@nestjs/*` or typeorm; cross-module calls go through exported use cases adapted to a local port; never read another module's tables (organization never touches `one_time_tokens` or `users`).
- Every write happens in `uow.run()`; `err()` rolls back. Expected failures are `err(new XxxError())` with codes from `src/contracts/error-codes.ts` and statuses in `error-status.ts`.
- Raw secrets never enter the outbox. Every new outbox topic must be registered in `OutboxTopics` by the module that consumes it.
- Permission codes come only from `src/contracts/permissions.ts`. Required permissions per route:
  - invite, list and revoke invitations: `member:invite`;
  - change roles/status and remove members: `member:manage`;
  - list roles: `role:read`;
  - create, update and delete roles: `role:manage`.
- **Escalation rule:** an actor may grant, revoke, create or edit only roles whose permission set ⊆ the actor's own effective permissions in that org (read from the DB, not the token). Suspending or removing a member also requires target permissions ⊆ actor permissions.
- **Last-owner rule:** no operation may leave an org with zero active memberships holding the system `owner` role → `ORG.LAST_OWNER` 409.
- Custom role key: `^[a-z][a-z0-9_-]{1,31}$`; the reserved keys `owner`, `admin` and `member` are rejected (`ORG.INVALID_ROLE_KEY` 422). System roles (`org_id IS NULL`) are not editable: org-scoped role lookups never return them, so edits get 404.
- Invitation TTL 7 days. Re-inviting the same `(orgId, email)` revokes the previous open invitation.
- No commits unless the user asks. pnpm `minimumReleaseAge` applies (no new packages expected).

New error codes (`OrgErrorCode`):

| Code | Status |
|---|---|
| `ORG.MEMBER_NOT_FOUND` | 404 |
| `ORG.ALREADY_MEMBER` | 409 |
| `ORG.LAST_OWNER` | 409 |
| `ORG.INSUFFICIENT_PRIVILEGE` | 403 |
| `ORG.ROLE_NOT_FOUND` | 404 |
| `ORG.ROLE_KEY_TAKEN` | 409 |
| `ORG.ROLE_IN_USE` | 409 |
| `ORG.INVALID_ROLE_KEY` | 422 |
| `ORG.INVITATION_INVALID` | 400 |
| `ORG.INVITATION_NOT_FOUND` | 404 |

## Review Focus

1. **Admin tries to make themselves (or someone) owner, or edits an owner.** Expect 403 `ORG.INSUFFICIENT_PRIVILEGE`. Tests: Task 4 `UpdateMember` escalation cases, and the e2e "admin cannot grant owner".
2. **The only owner demotes or suspends themselves, or is removed.** Expect 409 `ORG.LAST_OWNER`; with a second owner, the same operation succeeds. Tests: Task 4.
3. **Invitation accepted by a different account, an unverified email, a reused or expired token.** All give the same 400 `ORG.INVITATION_INVALID` (no oracle). Tests: Task 3 int + Task 4 + e2e.
4. **A role is deleted between invite and accept, or a role id from another org is sent.** Accept drops missing roles (falls back to system `member` if none remain). Cross-org role id → 404 `ORG.ROLE_NOT_FOUND` on PATCH; the DB trigger is the second line. Tests: Task 4.
5. **Deleting a role still assigned → 409 `ORG.ROLE_IN_USE`** (FK `ON DELETE RESTRICT` → mapped). Editing a role's permissions bumps `authz_epoch`. Tests: Task 2 int + Task 4.

---

### Task 1: Contracts + domain

**Files:**
- Modify: `src/contracts/error-codes.ts`, `src/contracts/error-status.ts`, `src/contracts/organization.schemas.ts`
- Create in `src/modules/organization/domain/`:
  - `role.ts` (`Role`, `RoleKey`, `PermissionSet`)
  - `invitation.ts` (`Invitation`)
  - `authorization-policy.ts`
- Modify: `src/modules/organization/domain/organization.errors.ts`, `membership.ts`, `organization.ts`
- Test: `role.spec.ts`, `membership.spec.ts`, `authorization-policy.spec.ts` (domain dir), plus a new case in `organization.spec.ts`

**Interfaces (produces):**
- **Schemas:**
  - `InviteMemberRequestSchema {email: z.email() (lower-cased, trimmed), roleIds: z.array(z.uuid()).min(1).max(10)}`
  - `AcceptInvitationRequestSchema {token: z.string().min(20).max(200)}`
  - `InvitationListResponseSchema {invitations: [{invitationId, email, roleIds, invitedBy, expiresAt: iso string, createdAt: iso string}]}`
  - `InvitationIdParamSchema`, `MembershipIdParamSchema`, `RoleIdParamSchema` (uuid)
  - `CreateRoleRequestSchema {key, name trim 1..100, permissions: z.array(z.enum(permission codes)).max(64)}`
  - `UpdateRoleRequestSchema {name?, permissions?}`, refined to require at least one field
  - `RoleSchema {id, key, name, system: boolean, permissions: string[]}`, `RoleListResponseSchema {roles}`
  - `UpdateMemberRequestSchema {roleIds?: uuid[] min1 max10, status?: 'active'|'suspended'}`, refined to require at least one field
- **Domain:**
  - `RoleKey.create(raw): Result<RoleKey, InvalidRoleKeyError>`
  - `Role.create({orgId, key: RoleKey, name, permissions: readonly Permission[], now}): Role`; `Role.reconstitute(id, props, version)`
  - Role getters: `orgId`, `key`, `name`, `permissions: PermissionSet`
  - `role.rename(name)`; `role.setPermissions(perms): boolean` (true when the set changed)
  - `RoleId` is the one already in `membership.ts`
- **Membership:**
  - `Membership.createMember({orgId, userId, roleIds: RoleId[], now})`: active, `authzVersion` 0, raises `organization.member_added`
  - `replaceRoles(roleIds): boolean`: diffs the WatchedList; when changed, `authzVersion += 1`
  - `suspend(): boolean`, `reactivate(): boolean`: no-op → false; otherwise change status and `authzVersion += 1`
- **Organization:** `bumpAuthzEpoch(): void`
- **Invitation:**
  - `Invitation.create({orgId, orgName, email, roleIds, invitedBy, now})` raises `organization.invitation.created`
  - The event payload is `{invitationId, orgId, orgName, email, roleIds, invitedBy}`; `aggregateId` = invitation id (UUIDv7)
- **Policy** (`authorization-policy.ts`):
  - `isSubset(granted: readonly string[], held: readonly string[]): boolean`
  - `ensureCanTouch(actorPerms, ...rolePermSets): Result<void, InsufficientPrivilegeError>`
- **Errors:** one class per new code (names: `MemberNotFoundError`, `AlreadyMemberError`, `LastOwnerError`, `InsufficientPrivilegeError`, `RoleNotFoundError`, `RoleKeyTakenError`, `RoleInUseError`, `InvalidRoleKeyError`, `InvitationInvalidError`, `InvitationNotFoundError`)

- [ ] **Failing tests:**
  - `RoleKey rejects reserved and malformed keys` (`owner`, `Admin`, `a`, `-x`) and accepts `billing_viewer`.
  - `setPermissions reports change only when the set differs; added/removed tracked`.
  - `replaceRoles bumps authzVersion once per real change`: same set → `false`, version unchanged.
  - `suspend/reactivate bump authzVersion and are idempotent`.
  - `createMember raises member_added with the given roles`.
  - `Organization.bumpAuthzEpoch increments`.
  - `ensureCanTouch: subset ok; superset → ORG.INSUFFICIENT_PRIVILEGE`.
  - `Invitation.create raises the event with the payload above`.
- [ ] Run `pnpm test src/modules/organization` → FAIL (missing modules); implement; → PASS. `pnpm exec tsc --noEmit --incremental false` clean.

### Task 2: Organization persistence

**Files:**
- Create in `src/modules/organization/infrastructure/`:
  - `typeorm-role.repository.ts`
  - `invitation-event.repository.ts`
- Modify: `typeorm-membership.repository.ts`, `organization-queries.ts`, `application/ports.ts`
- Test: `test/integration/organization-roles.int-spec.ts`

**Interfaces (produces):**
- `RoleRepository` (`ROLE_REPOSITORY`):
  - `findInOrg(orgId, roleId): Promise<Role | undefined>` returns custom roles only (`org_id = $1`).
  - `save(role)`: insert/update `roles` + the `role_permissions` diff. `roles` has no `version` column, so the update is unconditional (ruling: last writer wins on `name`; the permission diff is idempotent). Unique `roles_org_key_uq` → `RoleKeyTakenError`.
  - `delete(role)`: FK violation 23503 on `membership_roles` → `RoleInUseError`.
- `MembershipRepository` additions:
  - `findById(id: MembershipId): Promise<Membership | undefined>`
  - `delete(m: Membership): Promise<void>`: version-checked `DELETE … WHERE id AND version`, else `ConcurrencyConflictError`
- `InvitationRepository` (`INVITATION_REPOSITORY`): `save(inv)` = `markPersisted()` + `tx.track()` only. The record itself lives in identity (written by the worker).
- `OrganizationReads` additions:
  - `rolesOf(orgId): Promise<RoleView[]>`: system + custom, ordered system-first then key. `RoleView = {id, key, name, system, permissions: string[]}`.
  - `rolesByIds(orgId, ids): Promise<RoleView[]>`: only ids that are system or belong to `orgId`.
  - `activeOwnerCount(orgId): Promise<number>`: active memberships holding the system `owner` role.

- [ ] **Failing int tests:**
  - `role save/find round-trip with permissions; foreign org → undefined`.
  - `duplicate key in the same org → RoleKeyTakenError; same key in another org ok`.
  - `delete an assigned role → RoleInUseError; unassigned → gone`.
  - `rolesByIds filters out another org's role`.
  - `activeOwnerCount ignores suspended owners`.
  - `membership findById + delete; stale version → ConcurrencyConflictError`.
- [ ] Run `pnpm test:int` → FAIL; implement; → PASS.

### Task 3: Identity invitation façades

**Files:**
- Create in `src/modules/identity/application/`:
  - `issue-org-invitation.use-case.ts`
  - `consume-org-invitation.use-case.ts`
  - `list-org-invitations.use-case.ts`
  - `revoke-org-invitation.use-case.ts`
- Create: `src/database/migrations/0002-org-invite-index.migration.ts`
- Modify:
  - `application/ports.ts` (`OneTimeTokenRepository` gains `issueOrgInvite`, `revokeOpenOrgInvites(orgId, email)`, `consumeOrgInvite(hash, now)`, `listOpenOrgInvites(orgId, now)`, `revokeOrgInvite(orgId, invitationId)`; `EmailTemplate` gains `'org-invitation'`)
  - `infrastructure/typeorm-one-time-token.repository.ts`, `infrastructure/email-templates.ts`
  - `identity-core.module.ts`: providers and exports
  - `src/config/env.schema.ts`: `ORG_INVITATION_URL`, same shape and dev default style as `EMAIL_VERIFICATION_URL`; also `.env.example` and `buildTestConfig`
- Test: unit specs per use case + `test/integration/org-invite-tokens.int-spec.ts`

**Interfaces (produces):**
- `OrgInvitePayload = {invitationId, orgId, email, roleIds: string[], invitedBy}`, stored as `one_time_tokens.payload` with `user_id NULL`.
- `IssueOrgInvitationUseCase.execute({...OrgInvitePayload, orgName}): Promise<void>`:
  - Worker side, inside the caller's transaction.
  - Revokes open invites for `(orgId, email)`.
  - Mints the token (TTL 7 days) and sends `org-invitation` to `email` with link `${ORG_INVITATION_URL}?token=<raw>` and data `{orgName}`.
- `ConsumeOrgInvitationUseCase.execute({token, userId}): Promise<OrgInvitePayload | undefined>`:
  - Must be called inside a `uow.run`.
  - Consumes atomically (`UPDATE … WHERE purpose='org_invite' AND consumed_at IS NULL AND expires_at > now RETURNING payload`) only when the user exists, the user's email is verified, and `lower(payload->>'email') = user.email`.
  - Otherwise returns `undefined` and consumes nothing: verify the user first, then run the UPDATE with the email in its `WHERE`.
- `ListOrgInvitationsUseCase.execute({orgId}): Promise<{invitationId, email, roleIds, invitedBy, expiresAt: Date, createdAt: Date}[]>`: open and unexpired only.
- `RevokeOrgInvitationUseCase.execute({orgId, invitationId}): Promise<boolean>`
- Migration 0002: `CREATE INDEX one_time_tokens_org_invite_idx ON one_time_tokens ((payload->>'orgId')) WHERE purpose = 'org_invite' AND consumed_at IS NULL`, with a matching `down`.

- [ ] **Failing tests:**
  - **Unit:**
    - `issue revokes the previous open invite and sends one email with the link`
    - `consume: wrong email / unverified / unknown token → undefined, nothing consumed`
    - `consume twice → second undefined`
  - **Int:**
    - `list shows only open, unexpired invites of that org`
    - `revoke → removed from the list; unknown id → false`
    - `consume is atomic and case-insensitive on email`
- [ ] Run unit + int → FAIL; implement; → PASS. `pnpm build && pnpm db:migrate` is applied by global setup (verify the int run includes 0002).

### Task 4: Organization use cases

**Files:**
- Create in `src/modules/organization/application/`:
  - `invite-member.use-case.ts`, `accept-invitation.use-case.ts`
  - `list-invitations.use-case.ts`, `revoke-invitation.use-case.ts`
  - `list-roles.use-case.ts`, `create-role.use-case.ts`, `update-role.use-case.ts`, `delete-role.use-case.ts`
  - `update-member.use-case.ts`, `remove-member.use-case.ts`
- Modify: `application/ports.ts`. Add the `INVITATIONS` port, adapted from the Task 3 façades:
  - `issue` is not needed here (worker only);
  - `consume(token, userId)`, `list(orgId)`, `revoke(orgId, invitationId)`.
- Modify: `organization.test-support.ts` (fakes)
- Test: `organization-members.spec.ts`, `organization-roles.spec.ts`, `organization-invitations.spec.ts`

**Interfaces:**
- **Actor input:** every mutating use case takes `{actorUserId, orgId, ...}`. Actor permissions = `reads.membershipContext(actorUserId, orgId)?.permissions`; missing → `InsufficientPrivilegeError`.
- **`InviteMember.execute({actorUserId, orgId, email, roleIds})`** → `Result<{invitationId}, RoleNotFoundError | InsufficientPrivilegeError>`
  - Every roleId must be in `rolesByIds(orgId, roleIds)`, else `RoleNotFound`.
  - `ensureCanTouch(actor, ...rolePerms)`.
  - Then `Invitation.create` (`orgName` from `orgs.findById`) and save via `INVITATION_REPOSITORY`.
- **`AcceptInvitation.execute({userId, token})`** → `Result<{orgId}, InvitationInvalidError | AlreadyMemberError>`, all in one `uow.run`:
  1. Consume.
  2. Existing membership for `(orgId, userId)` → `AlreadyMember`. The err rolls back, so the token stays valid.
  3. Org missing or not active → `InvitationInvalid`.
  4. Keep the roleIds still returned by `rolesByIds`; if none remain, use the system `member` id (via `SystemRoleLookup.memberRoleId()`; add it to the lookup).
  5. `Membership.createMember` + save.
- **`ListInvitations` / `RevokeInvitation`:** `RevokeInvitation` returns `InvitationNotFoundError` when the façade returns false.
- **`ListRoles.execute({orgId})`** → `RoleView[]`.
- **`CreateRole.execute({actorUserId, orgId, key, name, permissions})`** → `Result<RoleView, InvalidRoleKeyError | RoleKeyTakenError | InsufficientPrivilegeError>`
  - Checks permissions ⊆ actor.
  - Catches the `RoleKeyTakenError` thrown by save.
- **`UpdateRole.execute({actorUserId, orgId, roleId, name?, permissions?})`**
  - Role not found → `RoleNotFound`.
  - Old perms ⊆ actor and new perms ⊆ actor.
  - When the permissions changed: `org.bumpAuthzEpoch()` + `orgs.save(org)` in the same tx.
- **`DeleteRole.execute({actorUserId, orgId, roleId})`** → `RoleNotFound | RoleInUse | InsufficientPrivilege`.
- **`UpdateMember.execute({actorUserId, orgId, membershipId, roleIds?, status?})`**
  1. Load by id; `orgId` mismatch → `MemberNotFound`.
  2. New roles via `rolesByIds` (missing → `RoleNotFound`).
  3. Escalation: the permissions of added roles, removed roles and (on status change) the target's current roles must all be ⊆ actor.
  4. Last owner: if the target is currently an active owner and the result removes `owner` or suspends, and `activeOwnerCount(orgId) <= 1` → `LastOwner`.
  5. Apply `replaceRoles` / `suspend` / `reactivate`; save.
- **`RemoveMember.execute({actorUserId, orgId, membershipId})`**: same lookup, escalation on the target's roles, last-owner check, then `memberships.delete`.

- [ ] **Failing unit tests** (fakes; system role ids `role-owner`, `role-admin`, `role-member` with `SYSTEM_ROLES` perms):
  - `admin cannot grant owner → INSUFFICIENT_PRIVILEGE`; `admin cannot suspend an owner`; `owner can grant admin`.
  - `sole owner demoting/suspending/removing self → LAST_OWNER`; `with a second owner → ok`.
  - `UpdateMember with a role id of another org → ROLE_NOT_FOUND`.
  - `role change bumps authzVersion; same roles → no save`.
  - `accept: consume undefined → INVITATION_INVALID; already member → ALREADY_MEMBER; deleted roles dropped, none left → member role`.
  - `invite: unknown role → ROLE_NOT_FOUND; admin inviting as owner → INSUFFICIENT_PRIVILEGE; ok → event pending with payload`.
  - `create role with a permission the actor lacks → INSUFFICIENT_PRIVILEGE`.
  - `update role permissions bumps org authzEpoch; rename only does not`.
  - `delete role in use → ROLE_IN_USE`.
- [ ] Run `pnpm test src/modules/organization` → FAIL; implement; → PASS.

### Task 5: HTTP, worker, wiring, e2e

**Files:**
- Create in `src/modules/organization/presentation/`:
  - `invitations.controller.ts`, `roles.controller.ts`, `members.controller.ts`
- Create: `src/modules/organization/infrastructure/organization-invitation.consumer.ts`, `src/modules/organization/organization-worker.module.ts`
- Modify:
  - `organization-core.module.ts`: providers; `onModuleInit` registers the topic `organization.invitation.created`
  - `organization-api.module.ts`
  - `app.module.ts`: `worker` role gets `OrganizationWorkerModule`
- Test: `test/e2e/organization-members.e2e-spec.ts`

**Routes** (all behind `AccessTokenGuard`; org-scoped ones also behind `PermissionsGuard` + `@RequirePermissions`):

| Route | Permission | Response |
|---|---|---|
| `POST /iam/orgs/:orgId/invitations` | `member:invite` | 202 `{invitationId}` |
| `GET /iam/orgs/:orgId/invitations` | `member:invite` | `InvitationListResponse` |
| `DELETE /iam/orgs/:orgId/invitations/:invitationId` | `member:invite` | 204 |
| `POST /iam/invitations/accept` | authenticated only | 200 `{orgId}` |
| `GET /iam/orgs/:orgId/roles` | `role:read` | `RoleListResponse` |
| `POST /iam/orgs/:orgId/roles` | `role:manage` | 201 `Role` |
| `PATCH /iam/orgs/:orgId/roles/:roleId` | `role:manage` | `Role` |
| `DELETE /iam/orgs/:orgId/roles/:roleId` | `role:manage` | 204 |
| `PATCH /iam/orgs/:orgId/members/:membershipId` | `member:manage` | 204 |
| `DELETE /iam/orgs/:orgId/members/:membershipId` | `member:manage` | 204 |

- **Consumer:** `@OnOutboxMessage('organization.invitation.created', { consumer: 'org-invitation-email' })` parses the payload defensively (throws on a malformed payload). It calls `IssueOrgInvitationUseCase` inside `processInTransaction`, following the `IdentityEmailConsumer.exactlyOnce` pattern.

- [ ] **Failing e2e** (role `api` + `IdentityHttpModule`, `SessionHttpModule`, `IdentityWorkerModule`, `OrganizationWorkerModule`; captured `EMAIL_SENDER`; `OutboxRelay.runOnce()`):
  - `owner invites → email with link → invitee (verified, same email) accepts → listed as member with the invited role; invitation no longer listed`
  - `accept with another account → 400 ORG.INVITATION_INVALID`
  - `admin cannot grant owner → 403 ORG.INSUFFICIENT_PRIVILEGE`
  - `sole owner cannot demote self → 409 ORG.LAST_OWNER`
  - `custom role: create (201) → assign via PATCH → member token after refresh carries its bits → delete while assigned → 409 ORG.ROLE_IN_USE`
  - `suspended member: refresh drops the org; switch → 403 ORG.NOT_MEMBER`
  - `remove member → 204; members list no longer shows them`
  - `revoke invitation → 204; accepting it → 400`
- [ ] Run → FAIL; implement; → PASS.

### Gate (no commit)

- [ ] `pnpm lint && pnpm exec tsc --noEmit --incremental false && pnpm test && pnpm test:e2e && pnpm test:e2e && pnpm test:int && pnpm build` → exit 0.
- [ ] **Manual check** with `login` + `api` + `worker` roles and a shared `JWT_SIGNING_KEYS`:
  1. Owner invites an email.
  2. The email shows up in Mailpit.
  3. The invitee registers, verifies and accepts.
  4. The owner creates a custom role and assigns it.
  5. The invitee refreshes and checks `pbits`.
- [ ] Update the roadmap (Phase 5 done). Ledger final notes. Report, and wait for the commit.
