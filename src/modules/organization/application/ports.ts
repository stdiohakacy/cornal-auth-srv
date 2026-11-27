import type { Invitation } from '../domain/invitation.js';
import type { Membership, MembershipId } from '../domain/membership.js';
import type { Role } from '../domain/role.js';
import type { Organization, OrganizationId } from '../domain/organization.js';

export const ORGANIZATION_REPOSITORY = Symbol('ORGANIZATION_REPOSITORY');
export interface OrganizationRepository {
  findById(id: OrganizationId): Promise<Organization | undefined>;
  /** Throws SlugTakenError on a duplicate slug. */
  save(org: Organization): Promise<void>;
}

export const MEMBERSHIP_REPOSITORY = Symbol('MEMBERSHIP_REPOSITORY');
export interface MembershipRepository {
  findById(id: MembershipId): Promise<Membership | undefined>;
  findByOrgAndUser(
    orgId: string,
    userId: string,
  ): Promise<Membership | undefined>;
  save(membership: Membership): Promise<void>;
  /** Version-checked; throws ConcurrencyConflictError on a stale aggregate. */
  delete(membership: Membership): Promise<void>;
}

export const ROLE_REPOSITORY = Symbol('ROLE_REPOSITORY');
export interface RoleRepository {
  /** Custom roles of `orgId` only; system roles are never returned. */
  findInOrg(orgId: string, roleId: string): Promise<Role | undefined>;
  /** Throws RoleKeyTakenError on a duplicate key in the org. */
  save(role: Role): Promise<void>;
  /** Throws RoleInUseError while the role is assigned. */
  delete(role: Role): Promise<void>;
}

export const INVITATION_REPOSITORY = Symbol('INVITATION_REPOSITORY');
export interface InvitationRepository {
  save(invitation: Invitation): Promise<void>;
}

export type MembershipContext = {
  readonly membershipId: string;
  readonly authzVersion: number;
  readonly authzEpoch: number;
  readonly mfaRequired: boolean;
  readonly permissions: readonly string[];
};
export type MyOrganization = {
  readonly orgId: string;
  readonly slug: string;
  readonly name: string;
  readonly roleKeys: readonly string[];
};
export type MemberEntry = {
  readonly membershipId: string;
  readonly userId: string;
  readonly status: string;
  readonly roleKeys: readonly string[];
};

export const ORGANIZATION_READS = Symbol('ORGANIZATION_READS');
export interface OrganizationReads {
  membershipContext(
    userId: string,
    orgId: string,
  ): Promise<MembershipContext | undefined>;
  activeMembershipsOf(userId: string): Promise<MyOrganization[]>;
  membersOf(orgId: string): Promise<MemberEntry[]>;
  /** System roles first (by key), then the org's custom roles (by key). */
  rolesOf(orgId: string): Promise<RoleView[]>;
  /** Only ids that are system roles or custom roles of `orgId`. */
  rolesByIds(orgId: string, ids: readonly string[]): Promise<RoleView[]>;
  /** Active memberships holding the system owner role. */
  activeOwnerCount(orgId: string): Promise<number>;
}

export type RoleView = {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly system: boolean;
  readonly permissions: readonly string[];
};

/** Identity façades, adapted in organization-core.module.ts. */
export const USER_DIRECTORY = Symbol('USER_DIRECTORY');
export interface UserDirectory {
  isEmailVerified(userId: string): Promise<boolean>;
  emailsOf(userIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
}

/** System role ids resolved by the catalog sync (access-control). */
export const SYSTEM_ROLE_LOOKUP = Symbol('SYSTEM_ROLE_LOOKUP');
export interface SystemRoleLookup {
  ownerRoleId(): string;
  memberRoleId(): string;
}

/** What an invitation grants (identity stores it with the single-use token). */
export type InvitationGrant = {
  readonly invitationId: string;
  readonly orgId: string;
  readonly email: string;
  readonly roleIds: readonly string[];
  readonly invitedBy: string;
};
export type PendingInvitation = InvitationGrant & {
  readonly expiresAt: Date;
  readonly createdAt: Date;
};

/** Identity's invitation-token façades, adapted in organization-core.module.ts. */
export const INVITATION_GATEWAY = Symbol('INVITATION_GATEWAY');
export interface InvitationGateway {
  /** Joins the caller's transaction; undefined for any invalid token or email mismatch. */
  consume(token: string, userId: string): Promise<InvitationGrant | undefined>;
  list(orgId: string): Promise<PendingInvitation[]>;
  revoke(orgId: string, invitationId: string): Promise<boolean>;
}
