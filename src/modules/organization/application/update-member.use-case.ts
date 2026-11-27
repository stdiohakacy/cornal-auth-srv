import type { UnitOfWork } from '#src/shared/application/ports.js';
import { err, ok, type Result } from '#src/shared/domain/result.js';
import { ensureCanTouch } from '../domain/authorization-policy.js';
import type { Membership, RoleId } from '../domain/membership.js';
import {
  type InsufficientPrivilegeError,
  type LastOwnerError,
  type MemberNotFoundError,
  RoleNotFoundError,
} from '../domain/organization.errors.js';
import { actorPermissions } from './actor-permissions.js';
import {
  ensureAnotherOwner,
  findMemberInOrg,
  isActiveOwner,
} from './member-guards.js';
import type {
  MembershipRepository,
  OrganizationReads,
  SystemRoleLookup,
} from './ports.js';

export type UpdateMemberError =
  | MemberNotFoundError
  | RoleNotFoundError
  | InsufficientPrivilegeError
  | LastOwnerError;

type TargetStatus = 'active' | 'suspended';
/** What the caller asked for; `roleIds` is de-duplicated. */
type MemberChange = {
  readonly roleIds?: readonly string[];
  readonly status?: TargetStatus;
};

/** Each transition reports whether it changed anything. */
const STATUS_TRANSITIONS: Record<
  TargetStatus,
  (member: Membership) => boolean
> = {
  suspended: (member) => member.suspend(),
  active: (member) => member.reactivate(),
};

/**
 * Replaces a member's roles and/or changes their status. No escalation (every role added or
 * removed, and on a status change the target's roles, must be within the actor's permissions) and
 * never zero active owners. Each real change bumps the membership's authz_version.
 */
export class UpdateMemberUseCase {
  constructor(
    private readonly reads: OrganizationReads,
    private readonly memberships: MembershipRepository,
    private readonly systemRoles: SystemRoleLookup,
    private readonly uow: UnitOfWork,
  ) {}

  async execute(input: {
    actorUserId: string;
    orgId: string;
    membershipId: string;
    roleIds?: readonly string[];
    status?: TargetStatus;
  }): Promise<Result<void, UpdateMemberError>> {
    const actor = await actorPermissions(
      this.reads,
      input.actorUserId,
      input.orgId,
    );
    if (!actor.ok) return actor;
    const change: MemberChange = {
      ...(input.roleIds ? { roleIds: [...new Set(input.roleIds)] } : {}),
      ...(input.status ? { status: input.status } : {}),
    };

    return this.uow.run(async (): Promise<Result<void, UpdateMemberError>> => {
      const found = await findMemberInOrg(
        this.memberships,
        input.orgId,
        input.membershipId,
      );
      if (!found.ok) return found;
      const member = found.value;

      const touched = await this.permissionsTouched(
        input.orgId,
        member,
        change,
      );
      if (!touched.ok) return touched;
      const allowed = ensureCanTouch(actor.value, ...touched.value);
      if (!allowed.ok) return allowed;

      if (this.dropsOwner(member, change)) {
        const ownersRemain = await ensureAnotherOwner(this.reads, input.orgId);
        if (!ownersRemain.ok) return ownersRemain;
      }

      if (applyChange(member, change)) await this.memberships.save(member);
      return ok(undefined);
    });
  }

  /**
   * Permission sets the change grants or takes away: roles added, roles removed, and on a status
   * change every role the member holds.
   */
  private async permissionsTouched(
    orgId: string,
    member: Membership,
    change: MemberChange,
  ): Promise<Result<(readonly string[])[], RoleNotFoundError>> {
    const current = await this.reads.rolesByIds(orgId, member.roles.items);
    const touched: (readonly string[])[] = [];

    const wanted = change.roleIds;
    if (wanted) {
      const next = await this.reads.rolesByIds(orgId, wanted);
      if (next.length !== wanted.length) return err(new RoleNotFoundError());
      const added = next.filter((role) => !member.roles.has(role.id as RoleId));
      const removed = current.filter((role) => !wanted.includes(role.id));
      touched.push(...[...added, ...removed].map((role) => role.permissions));
    }
    if (change.status !== undefined && change.status !== member.status)
      touched.push(...current.map((role) => role.permissions));
    return ok(touched);
  }

  private dropsOwner(member: Membership, change: MemberChange): boolean {
    const ownerId = this.systemRoles.ownerRoleId();
    if (!isActiveOwner(member, ownerId)) return false;
    const losesRole =
      change.roleIds !== undefined && !change.roleIds.includes(ownerId);
    return losesRole || change.status === 'suspended';
  }
}

/** Applies the change to the aggregate; true when anything actually changed. */
function applyChange(member: Membership, change: MemberChange): boolean {
  // role ids were validated against this org's roles in permissionsTouched
  const rolesChanged = change.roleIds
    ? member.replaceRoles(change.roleIds as RoleId[])
    : false;
  const statusChanged = change.status
    ? STATUS_TRANSITIONS[change.status](member)
    : false;
  return rolesChanged || statusChanged;
}
