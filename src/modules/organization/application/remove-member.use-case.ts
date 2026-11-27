import type { UnitOfWork } from '#src/shared/application/ports.js';
import { ok, type Result } from '#src/shared/domain/result.js';
import { ensureCanTouch } from '../domain/authorization-policy.js';
import type {
  InsufficientPrivilegeError,
  LastOwnerError,
  MemberNotFoundError,
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
      const found = await findMemberInOrg(
        this.memberships,
        input.orgId,
        input.membershipId,
      );
      if (!found.ok) return found;
      const member = found.value;

      const roles = await this.reads.rolesByIds(
        input.orgId,
        member.roles.items,
      );
      const allowed = ensureCanTouch(
        actor.value,
        ...roles.map((role) => role.permissions),
      );
      if (!allowed.ok) return allowed;

      if (isActiveOwner(member, this.systemRoles.ownerRoleId())) {
        const ownersRemain = await ensureAnotherOwner(this.reads, input.orgId);
        if (!ownersRemain.ok) return ownersRemain;
      }

      await this.memberships.delete(member);
      return ok(undefined);
    });
  }
}
