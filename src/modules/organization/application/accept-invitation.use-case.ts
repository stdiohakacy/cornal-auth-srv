import type { Clock, UnitOfWork } from '../../../shared/application/ports.js';
import { err, ok, type Result } from '../../../shared/domain/result.js';
import { Membership, type RoleId } from '../domain/membership.js';
import {
  AlreadyMemberError,
  InvitationInvalidError,
} from '../domain/organization.errors.js';
import type { OrganizationId } from '../domain/organization.js';
import type {
  InvitationGateway,
  MembershipRepository,
  OrganizationReads,
  OrganizationRepository,
  SystemRoleLookup,
} from './ports.js';

export type AcceptInvitationError = InvitationInvalidError | AlreadyMemberError;

/**
 * A signed-in user accepts an invitation addressed to their verified email. One transaction:
 * the token is consumed only if the membership is created (an error rolls the consumption back).
 * Roles deleted since the invite are dropped; if none remain the member gets the system member role.
 */
export class AcceptInvitationUseCase {
  constructor(
    private readonly invitations: InvitationGateway,
    private readonly orgs: OrganizationRepository,
    private readonly memberships: MembershipRepository,
    private readonly reads: OrganizationReads,
    private readonly systemRoles: SystemRoleLookup,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  execute(input: {
    userId: string;
    token: string;
  }): Promise<Result<{ orgId: string }, AcceptInvitationError>> {
    return this.uow.run(
      async (): Promise<Result<{ orgId: string }, AcceptInvitationError>> => {
        const grant = await this.invitations.consume(input.token, input.userId);
        if (!grant) return err(new InvitationInvalidError());
        if (await this.memberships.findByOrgAndUser(grant.orgId, input.userId))
          return err(new AlreadyMemberError());
        // orgId was written by our own InviteMember use case
        const org = await this.orgs.findById(grant.orgId as OrganizationId);
        if (!org || org.snapshot.status !== 'active')
          return err(new InvitationInvalidError());

        const kept = (
          await this.reads.rolesByIds(grant.orgId, grant.roleIds)
        ).map((role) => role.id);
        const roleIds = (
          kept.length > 0 ? kept : [this.systemRoles.memberRoleId()]
        ) as RoleId[];
        const membership = Membership.createMember({
          orgId: grant.orgId,
          userId: input.userId,
          roleIds,
          now: this.clock.now(),
        });
        await this.memberships.save(membership);
        return ok({ orgId: grant.orgId });
      },
    );
  }
}
