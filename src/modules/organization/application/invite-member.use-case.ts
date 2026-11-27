import type { Clock, UnitOfWork } from '../../../shared/application/ports.js';
import { err, ok, type Result } from '../../../shared/domain/result.js';
import { ensureCanTouch } from '../domain/authorization-policy.js';
import { Invitation } from '../domain/invitation.js';
import {
  InsufficientPrivilegeError,
  RoleNotFoundError,
} from '../domain/organization.errors.js';
import type { OrganizationId } from '../domain/organization.js';
import { actorPermissions } from './actor-permissions.js';
import type {
  InvitationRepository,
  OrganizationReads,
  OrganizationRepository,
} from './ports.js';

export type InviteMemberError = RoleNotFoundError | InsufficientPrivilegeError;

/**
 * Records an invitation request. The worker mints the single-use token and sends the email
 * (identity), so the API never holds the secret. Invited roles must be within the actor's own.
 */
export class InviteMemberUseCase {
  constructor(
    private readonly reads: OrganizationReads,
    private readonly orgs: OrganizationRepository,
    private readonly invitations: InvitationRepository,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    actorUserId: string;
    orgId: string;
    email: string;
    roleIds: readonly string[];
  }): Promise<Result<{ invitationId: string }, InviteMemberError>> {
    const actor = await actorPermissions(
      this.reads,
      input.actorUserId,
      input.orgId,
    );
    if (!actor.ok) return actor;
    const roleIds = [...new Set(input.roleIds)];
    const roles = await this.reads.rolesByIds(input.orgId, roleIds);
    if (roles.length !== roleIds.length) return err(new RoleNotFoundError());
    const allowed = ensureCanTouch(
      actor.value,
      ...roles.map((role) => role.permissions),
    );
    if (!allowed.ok) return allowed;
    // orgId comes from the route and matched the token's org in PermissionsGuard
    const org = await this.orgs.findById(input.orgId as OrganizationId);
    if (!org) return err(new InsufficientPrivilegeError());

    const invitation = Invitation.create({
      orgId: input.orgId,
      orgName: org.snapshot.name,
      email: input.email.toLowerCase(),
      roleIds,
      invitedBy: input.actorUserId,
      now: this.clock.now(),
    });
    return this.uow.run(async () => {
      await this.invitations.save(invitation);
      return ok({ invitationId: invitation.id });
    });
  }
}
