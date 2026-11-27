import type { MyOrganization, OrganizationReads } from './ports.js';

export class ListMyOrganizationsUseCase {
  constructor(private readonly reads: OrganizationReads) {}

  async execute(input: { userId: string }): Promise<MyOrganization[]> {
    return this.reads.activeMembershipsOf(input.userId);
  }
}
