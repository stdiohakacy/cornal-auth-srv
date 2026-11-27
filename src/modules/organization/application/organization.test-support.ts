import type { Clock, UnitOfWork } from '#src/shared/application/ports.js';
import type { Result } from '#src/shared/domain/result.js';
import { SYSTEM_ROLES } from '#src/contracts/permissions.js';
import type { Membership, MembershipId, RoleId } from '../domain/membership.js';
import type { Invitation } from '../domain/invitation.js';
import {
  RoleInUseError,
  RoleKeyTakenError,
  SlugTakenError,
} from '../domain/organization.errors.js';
import type { Role } from '../domain/role.js';
import type { Organization, OrganizationId } from '../domain/organization.js';
import type {
  MembershipContext,
  MembershipRepository,
  MemberEntry,
  MyOrganization,
  OrganizationReads,
  OrganizationRepository,
  RoleView,
  InvitationGateway,
  InvitationGrant,
  InvitationRepository,
  PendingInvitation,
  RoleRepository,
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
  memberRoleId: () => 'role-member',
};

export class InMemoryRoles implements RoleRepository {
  readonly rows = new Map<string, Role>();
  /** Role ids treated as assigned (delete → RoleInUseError). */
  readonly inUse = new Set<string>();
  async findInOrg(orgId: string, roleId: string) {
    const role = this.rows.get(roleId);
    return role?.orgId === orgId ? role : undefined;
  }
  async save(role: Role) {
    const clash = [...this.rows.values()].some(
      (r) =>
        r.id !== role.id &&
        r.orgId === role.orgId &&
        r.key.value === role.key.value,
    );
    if (clash) throw new RoleKeyTakenError();
    role.markPersisted();
    this.rows.set(role.id, role);
  }
  async delete(role: Role) {
    if (this.inUse.has(role.id)) throw new RoleInUseError();
    this.rows.delete(role.id);
  }
}

export class InMemoryInvitations implements InvitationRepository {
  readonly saved: Invitation[] = [];
  async save(invitation: Invitation) {
    this.saved.push(invitation);
  }
}

export class FakeInvitationGateway implements InvitationGateway {
  /** token → grant; consumed tokens are removed. */
  readonly payloads = new Map<string, InvitationGrant>();
  readonly pending: PendingInvitation[] = [];
  async consume(token: string) {
    const grant = this.payloads.get(token);
    this.payloads.delete(token);
    return grant;
  }
  async list(orgId: string) {
    return this.pending.filter((p) => p.orgId === orgId);
  }
  async revoke(orgId: string, invitationId: string) {
    const index = this.pending.findIndex(
      (p) => p.orgId === orgId && p.invitationId === invitationId,
    );
    if (index >= 0) this.pending.splice(index, 1);
    return index >= 0;
  }
}

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
  saves = 0;
  async findById(id: MembershipId) {
    return this.rows.find((m) => m.id === id);
  }
  async findByOrgAndUser(orgId: string, userId: string) {
    return this.rows.find((m) => m.orgId === orgId && m.userId === userId);
  }
  async save(membership: Membership) {
    this.saves += 1;
    membership.markPersisted();
    if (!this.rows.includes(membership)) this.rows.push(membership);
  }
  async delete(membership: Membership) {
    this.rows.splice(this.rows.indexOf(membership), 1);
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
  /** Role catalog of the fake world: orgId null = system role. */
  readonly roles: (RoleView & { orgId: string | null })[] = [
    {
      id: 'role-owner',
      key: 'owner',
      name: 'Owner',
      system: true,
      orgId: null,
      permissions: SYSTEM_ROLES.owner,
    },
    {
      id: 'role-admin',
      key: 'admin',
      name: 'Admin',
      system: true,
      orgId: null,
      permissions: SYSTEM_ROLES.admin,
    },
    {
      id: 'role-member',
      key: 'member',
      name: 'Member',
      system: true,
      orgId: null,
      permissions: SYSTEM_ROLES.member,
    },
  ];
  /** Owner counting reads these memberships (wire the same InMemoryMemberships as the use case). */
  ownerSource: InMemoryMemberships | undefined;
  async rolesOf(orgId: string) {
    return this.roles
      .filter((r) => r.orgId === null || r.orgId === orgId)
      .map(({ orgId: _o, ...view }) => view);
  }
  async rolesByIds(orgId: string, ids: readonly string[]) {
    return (await this.rolesOf(orgId)).filter((r) => ids.includes(r.id));
  }
  async activeOwnerCount(orgId: string) {
    return (this.ownerSource?.rows ?? []).filter(
      (m) =>
        m.orgId === orgId && m.isActive && m.roles.has('role-owner' as RoleId),
    ).length;
  }
}
