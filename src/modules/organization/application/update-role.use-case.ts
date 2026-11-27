import type { Permission } from '../../../contracts/permissions.js';
import type { UnitOfWork } from '../../../shared/application/ports.js';
import { InvariantViolation } from '../../../shared/domain/domain-error.js';
import { err, ok, type Result } from '../../../shared/domain/result.js';
import { ensureCanTouch } from '../domain/authorization-policy.js';
import {
  type InsufficientPrivilegeError,
  RoleNotFoundError,
} from '../domain/organization.errors.js';
import type { OrganizationId } from '../domain/organization.js';
import { actorPermissions } from './actor-permissions.js';
import type {
  OrganizationReads,
  OrganizationRepository,
  RoleRepository,
  RoleView,
} from './ports.js';
import { toRoleView } from './role-view.js';

export type UpdateRoleError = RoleNotFoundError | InsufficientPrivilegeError;

/**
 * Renames a custom role and/or replaces its permissions. A permission change bumps the org's
 * authz_epoch in the same transaction: every token of the org becomes stale (Phase 6 enforces).
 */
export class UpdateRoleUseCase {
  constructor(
    private readonly reads: OrganizationReads,
    private readonly roles: RoleRepository,
    private readonly orgs: OrganizationRepository,
    private readonly uow: UnitOfWork,
  ) {}

  async execute(input: {
    actorUserId: string;
    orgId: string;
    roleId: string;
    name?: string;
    permissions?: readonly Permission[];
  }): Promise<Result<RoleView, UpdateRoleError>> {
    const actor = await actorPermissions(
      this.reads,
      input.actorUserId,
      input.orgId,
    );
    if (!actor.ok) return actor;

    return this.uow.run(
      async (): Promise<Result<RoleView, UpdateRoleError>> => {
        const role = await this.roles.findInOrg(input.orgId, input.roleId);
        if (!role) return err(new RoleNotFoundError());
        const allowed = ensureCanTouch(
          actor.value,
          role.permissions.items,
          input.permissions ?? [],
        );
        if (!allowed.ok) return allowed;

        if (input.name !== undefined) role.rename(input.name);
        const permissionsChanged = input.permissions
          ? role.setPermissions(input.permissions)
          : false;
        await this.roles.save(role);
        if (permissionsChanged) {
          // orgId comes from the route and matched the token's org in PermissionsGuard
          const org = await this.orgs.findById(input.orgId as OrganizationId);
          if (!org)
            throw new InvariantViolation(
              `Organization ${input.orgId} of role ${role.id} is missing`,
            );
          org.bumpAuthzEpoch();
          await this.orgs.save(org);
        }

        return ok(toRoleView(role));
      },
    );
  }
}
