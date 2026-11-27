import type { OrganizationReads, RoleView } from './ports.js';

export class ListRolesUseCase {
  constructor(private readonly reads: OrganizationReads) {}

  execute(input: { orgId: string }): Promise<RoleView[]> {
    return this.reads.rolesOf(input.orgId);
  }
}
