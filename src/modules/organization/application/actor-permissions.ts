import { err, ok, type Result } from '#src/shared/domain/result.js';
import { InsufficientPrivilegeError } from '../domain/organization.errors.js';
import type { OrganizationReads } from './ports.js';

/**
 * Effective permissions of the acting user in `orgId`, read from the database (not the token), so
 * a stale token cannot be used to grant what was just taken away.
 */
export async function actorPermissions(
  reads: OrganizationReads,
  actorUserId: string,
  orgId: string,
): Promise<Result<readonly string[], InsufficientPrivilegeError>> {
  const context = await reads.membershipContext(actorUserId, orgId);
  return context
    ? ok(context.permissions)
    : err(new InsufficientPrivilegeError());
}
