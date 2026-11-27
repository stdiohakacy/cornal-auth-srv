import { err, ok, type Result } from '#src/shared/domain/result.js';
import type { Membership, MembershipId, RoleId } from '../domain/membership.js';
import {
  LastOwnerError,
  MemberNotFoundError,
} from '../domain/organization.errors.js';
import type { MembershipRepository, OrganizationReads } from './ports.js';

/** The membership, only if it belongs to `orgId` (another org's id reads as not found). */
export async function findMemberInOrg(
  memberships: MembershipRepository,
  orgId: string,
  membershipId: string,
): Promise<Result<Membership, MemberNotFoundError>> {
  // ids come from a schema-validated route param; ownership is checked right below
  const member = await memberships.findById(membershipId as MembershipId);
  return member && member.orgId === orgId
    ? ok(member)
    : err(new MemberNotFoundError());
}

export function isActiveOwner(
  member: Membership,
  ownerRoleId: string,
): boolean {
  // the owner role id comes from the catalog sync
  return member.isActive && member.roles.has(ownerRoleId as RoleId);
}

/** Call before an active owner stops being one: an org never drops to zero active owners. */
export async function ensureAnotherOwner(
  reads: OrganizationReads,
  orgId: string,
): Promise<Result<void, LastOwnerError>> {
  return (await reads.activeOwnerCount(orgId)) > 1
    ? ok(undefined)
    : err(new LastOwnerError());
}
