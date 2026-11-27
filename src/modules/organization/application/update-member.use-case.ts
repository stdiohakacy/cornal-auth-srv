import type { UnitOfWork } from '../../../shared/application/ports.js';
import { err, ok, type Result } from '../../../shared/domain/result.js';
import { ensureCanTouch } from '../domain/authorization-policy.js';
import type { MembershipId, RoleId } from '../domain/membership.js';
import {
  type InsufficientPrivilegeError,
  LastOwnerError,
  MemberNotFoundError,
  RoleNotFoundError,
} from '../domain/organization.errors.js';
import { actorPermissions } from './actor-permissions.js';
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
    status?: 'active' | 'suspended';
  }): Promise<Result<void, UpdateMemberError>> {
    const actor = await actorPermissions(
      this.reads,
      input.actorUserId,
      input.orgId,
    );
    if (!actor.ok) return actor;

    return this.uow.run(async (): Promise<Result<void, UpdateMemberError>> => {
      // ids come from a schema-validated route param; ownership is checked right below
      const member = await this.memberships.findById(
        input.membershipId as MembershipId,
      );
      if (!member || member.orgId !== input.orgId)
        return err(new MemberNotFoundError());
      const current = await this.reads.rolesByIds(
        input.orgId,
        member.roles.items,
      );

      const touched: (readonly string[])[] = [];
      const wanted =
        input.roleIds === undefined ? undefined : [...new Set(input.roleIds)];
      if (wanted) {
        const next = await this.reads.rolesByIds(input.orgId, wanted);
        if (next.length !== wanted.length) return err(new RoleNotFoundError());
        for (const role of next)
          if (!member.roles.has(role.id as RoleId))
            touched.push(role.permissions);
        for (const role of current)
          if (!wanted.includes(role.id)) touched.push(role.permissions);
      }
      const statusChange =
        input.status !== undefined && input.status !== member.status;
      if (statusChange)
        touched.push(...current.map((role) => role.permissions));
      const allowed = ensureCanTouch(actor.value, ...touched);
      if (!allowed.ok) return allowed;

      const ownerId = this.systemRoles.ownerRoleId();
      const losesOwner =
        member.isActive &&
        member.roles.has(ownerId as RoleId) &&
        ((wanted !== undefined && !wanted.includes(ownerId)) ||
          input.status === 'suspended');
      if (losesOwner && (await this.reads.activeOwnerCount(input.orgId)) <= 1)
        return err(new LastOwnerError());

      // ids validated against this org's roles above
      const rolesChanged = wanted
        ? member.replaceRoles(wanted as RoleId[])
        : false;
      const statusChanged =
        input.status === 'suspended'
          ? member.suspend()
          : input.status === 'active'
            ? member.reactivate()
            : false;
      if (rolesChanged || statusChanged) await this.memberships.save(member);
      return ok(undefined);
    });
  }
}
