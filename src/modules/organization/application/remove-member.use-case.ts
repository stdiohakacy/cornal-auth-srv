import type { UnitOfWork } from '../../../shared/application/ports.js';
import { err, ok, type Result } from '../../../shared/domain/result.js';
import { ensureCanTouch } from '../domain/authorization-policy.js';
import type { MembershipId, RoleId } from '../domain/membership.js';
import {
  type InsufficientPrivilegeError,
  LastOwnerError,
  MemberNotFoundError,
} from '../domain/organization.errors.js';
import { actorPermissions } from './actor-permissions.js';
import type {
  MembershipRepository,
  OrganizationReads,
  SystemRoleLookup,
} from './ports.js';

export type RemoveMemberError =
  MemberNotFoundError | InsufficientPrivilegeError | LastOwnerError;

/** Removes a member (their roles go with the membership). Same escalation and last-owner rules. */
export class RemoveMemberUseCase {
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
  }): Promise<Result<void, RemoveMemberError>> {
    const actor = await actorPermissions(
      this.reads,
      input.actorUserId,
      input.orgId,
    );
    if (!actor.ok) return actor;

    return this.uow.run(async (): Promise<Result<void, RemoveMemberError>> => {
      // ids come from a schema-validated route param; ownership is checked right below
      const member = await this.memberships.findById(
        input.membershipId as MembershipId,
      );
      if (!member || member.orgId !== input.orgId)
        return err(new MemberNotFoundError());
      const roles = await this.reads.rolesByIds(
        input.orgId,
        member.roles.items,
      );
      const allowed = ensureCanTouch(
        actor.value,
        ...roles.map((role) => role.permissions),
      );
      if (!allowed.ok) return allowed;

      const isActiveOwner =
        member.isActive &&
        member.roles.has(this.systemRoles.ownerRoleId() as RoleId);
      if (
        isActiveOwner &&
        (await this.reads.activeOwnerCount(input.orgId)) <= 1
      )
        return err(new LastOwnerError());

      await this.memberships.delete(member);
      return ok(undefined);
    });
  }
}
