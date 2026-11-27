import type { UnitOfWork } from '#src/shared/application/ports.js';
import { err, ok, type Result } from '#src/shared/domain/result.js';
import { ensureCanTouch } from '../domain/authorization-policy.js';
import {
  type InsufficientPrivilegeError,
  RoleInUseError,
  RoleNotFoundError,
} from '../domain/organization.errors.js';
import { actorPermissions } from './actor-permissions.js';
import type { OrganizationReads, RoleRepository } from './ports.js';

export type DeleteRoleError =
  RoleNotFoundError | RoleInUseError | InsufficientPrivilegeError;

/** Deletes an unassigned custom role (assigned → 409; unassign it first). */
export class DeleteRoleUseCase {
  constructor(
    private readonly reads: OrganizationReads,
    private readonly roles: RoleRepository,
    private readonly uow: UnitOfWork,
  ) {}

  async execute(input: {
    actorUserId: string;
    orgId: string;
    roleId: string;
  }): Promise<Result<void, DeleteRoleError>> {
    const actor = await actorPermissions(
      this.reads,
      input.actorUserId,
      input.orgId,
    );
    if (!actor.ok) return actor;
    try {
      return await this.uow.run(
        async (): Promise<Result<void, DeleteRoleError>> => {
          const role = await this.roles.findInOrg(input.orgId, input.roleId);
          if (!role) return err(new RoleNotFoundError());
          const allowed = ensureCanTouch(actor.value, role.permissions.items);
          if (!allowed.ok) return allowed;
          await this.roles.delete(role);
          return ok(undefined);
        },
      );
    } catch (error) {
      if (error instanceof RoleInUseError) return err(error);
      throw error;
    }
  }
}
