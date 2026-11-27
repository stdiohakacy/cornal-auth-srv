import type { Membership } from '../domain/membership.js';
import type { Organization, OrganizationId } from '../domain/organization.js';

export const ORGANIZATION_REPOSITORY = Symbol('ORGANIZATION_REPOSITORY');
export interface OrganizationRepository {
  findById(id: OrganizationId): Promise<Organization | undefined>;
  /** Throws SlugTakenError on a duplicate slug. */
  save(org: Organization): Promise<void>;
}

export const MEMBERSHIP_REPOSITORY = Symbol('MEMBERSHIP_REPOSITORY');
export interface MembershipRepository {
  findByOrgAndUser(
    orgId: string,
    userId: string,
  ): Promise<Membership | undefined>;
  save(membership: Membership): Promise<void>;
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
}

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
}
