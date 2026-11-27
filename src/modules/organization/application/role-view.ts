import type { Role } from '../domain/role.js';
import type { RoleView } from './ports.js';

/** Response shape of a custom role (permissions sorted for stable output). */
export const toRoleView = (role: Role): RoleView => ({
  id: role.id,
  key: role.key.value,
  name: role.name,
  system: false,
  permissions: [...role.permissions.items].sort(),
});
