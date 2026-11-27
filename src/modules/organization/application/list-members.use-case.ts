import type { OrganizationReads, UserDirectory } from './ports.js';

export type MemberView = {
  readonly membershipId: string;
  readonly userId: string;
  readonly email: string | null;
  readonly status: string;
  readonly roles: readonly string[];
};

export class ListMembersUseCase {
  constructor(
    private readonly reads: OrganizationReads,
    private readonly users: UserDirectory,
  ) {}

  async execute(input: { orgId: string }): Promise<MemberView[]> {
    const members = await this.reads.membersOf(input.orgId);
    const emails = await this.users.emailsOf(members.map((m) => m.userId));
    return members.map((m) => ({
      membershipId: m.membershipId,
      userId: m.userId,
      email: emails.get(m.userId) ?? null,
      status: m.status,
      roles: m.roleKeys,
    }));
  }
}
