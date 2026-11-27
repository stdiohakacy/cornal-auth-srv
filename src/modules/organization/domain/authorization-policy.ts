import { err, ok, type Result } from '../../../shared/domain/result.js';
import { InsufficientPrivilegeError } from './organization.errors.js';

export const isSubset = (
  granted: readonly string[],
  held: readonly string[],
): boolean => {
  const set = new Set(held);
  return granted.every((code) => set.has(code));
};

/**
 * No escalation: an actor may grant, revoke, define or act on a role/member only when every
 * permission involved is one the actor holds in that organization.
 */
export function ensureCanTouch(
  actorPermissions: readonly string[],
  ...permissionSets: ReadonlyArray<readonly string[]>
): Result<void, InsufficientPrivilegeError> {
  return permissionSets.every((set) => isSubset(set, actorPermissions))
    ? ok(undefined)
    : err(new InsufficientPrivilegeError());
}
