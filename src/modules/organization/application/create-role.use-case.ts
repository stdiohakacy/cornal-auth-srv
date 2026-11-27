import type { Permission } from '../../../contracts/permissions.js';
import type { Clock, UnitOfWork } from '../../../shared/application/ports.js';
import { err, ok, type Result } from '../../../shared/domain/result.js';
import { ensureCanTouch } from '../domain/authorization-policy.js';
import {
  type InsufficientPrivilegeError,
  type InvalidRoleKeyError,
  RoleKeyTakenError,
} from '../domain/organization.errors.js';
import { Role, RoleKey } from '../domain/role.js';
import { actorPermissions } from './actor-permissions.js';
import type { OrganizationReads, RoleRepository, RoleView } from './ports.js';
import { toRoleView } from './role-view.js';

export type CreateRoleError =
  InvalidRoleKeyError | RoleKeyTakenError | InsufficientPrivilegeError;

/** Defines a custom role; its permissions must be within the actor's own. */
export class CreateRoleUseCase {
  constructor(
    private readonly reads: OrganizationReads,
    private readonly roles: RoleRepository,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    actorUserId: string;
    orgId: string;
    key: string;
    name: string;
    permissions: readonly Permission[];
  }): Promise<Result<RoleView, CreateRoleError>> {
    const actor = await actorPermissions(
      this.reads,
      input.actorUserId,
      input.orgId,
    );
    if (!actor.ok) return actor;
    const key = RoleKey.create(input.key);
    if (!key.ok) return key;
    const allowed = ensureCanTouch(actor.value, input.permissions);
    if (!allowed.ok) return allowed;

    const role = Role.create({
      orgId: input.orgId,
      key: key.value,
      name: input.name,
      permissions: input.permissions,
      now: this.clock.now(),
    });
    try {
      return await this.uow.run(async () => {
        await this.roles.save(role);
        return ok(toRoleView(role));
      });
    } catch (error) {
      if (error instanceof RoleKeyTakenError) return err(error);
      throw error;
    }
  }
}
