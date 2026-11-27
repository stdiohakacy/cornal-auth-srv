import type { Clock, UnitOfWork } from '../../../shared/application/ports.js';
import type { Result } from '../../../shared/domain/result.js';
import type { Membership } from '../domain/membership.js';
import { SlugTakenError } from '../domain/organization.errors.js';
import type { Organization, OrganizationId } from '../domain/organization.js';
import type {
  MembershipContext,
  MembershipRepository,
  MemberEntry,
  MyOrganization,
  OrganizationReads,
  OrganizationRepository,
  SystemRoleLookup,
  UserDirectory,
} from './ports.js';

/** Test doubles for organization use cases. Imported by *.spec.ts only. */
export const NOW = new Date('2026-11-27T12:00:00Z');
export const fixedClock: Clock = { now: () => NOW };
export const passthroughUow: UnitOfWork = {
  run: <T, E>(work: () => Promise<Result<T, E>>) => work(),
};
export const systemRoles: SystemRoleLookup = {
  ownerRoleId: () => 'role-owner',
};

export class InMemoryOrganizations implements OrganizationRepository {
  readonly rows = new Map<string, Organization>();
  async findById(id: OrganizationId) {
    return this.rows.get(id);
  }
  async save(org: Organization) {
    const clash = [...this.rows.values()].find(
      (o) =>
        o.id !== org.id && o.snapshot.slug.value === org.snapshot.slug.value,
    );
    if (clash) throw new SlugTakenError();
    org.markPersisted();
    this.rows.set(org.id, org);
  }
}

export class InMemoryMemberships implements MembershipRepository {
  readonly rows: Membership[] = [];
  async findByOrgAndUser(orgId: string, userId: string) {
    return this.rows.find((m) => m.orgId === orgId && m.userId === userId);
  }
  async save(membership: Membership) {
    membership.markPersisted();
    if (!this.rows.includes(membership)) this.rows.push(membership);
  }
}

export class FakeDirectory implements UserDirectory {
  readonly verified = new Set<string>();
  readonly emails = new Map<string, string>();
  async isEmailVerified(userId: string) {
    return this.verified.has(userId);
  }
  async emailsOf(userIds: readonly string[]) {
    return new Map(
      userIds.flatMap((id) => {
        const email = this.emails.get(id);
        return email === undefined ? [] : [[id, email] as const];
      }),
    );
  }
}

export class FakeReads implements OrganizationReads {
  readonly contexts = new Map<string, MembershipContext>();
  memberships: MyOrganization[] = [];
  members: MemberEntry[] = [];
  async membershipContext(userId: string, orgId: string) {
    return this.contexts.get(`${userId}:${orgId}`);
  }
  async activeMembershipsOf() {
    return this.memberships;
  }
  async membersOf() {
    return this.members;
  }
}
