import type { PermissionCatalog } from '../sdk/permission-bits.js';

/**
 * The permission catalog. Bit indices are part of every access token (`pbits`) and of every
 * service's decoder: APPEND-ONLY. Never change or reuse a bit; deprecate instead. Adding an entry
 * requires bumping PERMISSION_CATALOG_VERSION and extending the lock in permissions.spec.ts.
 * Synced into the `permissions` table at boot.
 */
export const PERMISSIONS = [
  { code: 'org:read', bit: 0, description: 'View the organization' },
  { code: 'org:manage', bit: 1, description: 'Change organization settings' },
  { code: 'member:read', bit: 2, description: 'List members' },
  { code: 'member:invite', bit: 3, description: 'Invite members' },
  {
    code: 'member:manage',
    bit: 4,
    description: "Change members' roles and status",
  },
  { code: 'role:read', bit: 5, description: 'List roles' },
  { code: 'role:manage', bit: 6, description: 'Create and edit custom roles' },
  { code: 'audit:read', bit: 7, description: 'Read the audit log' },
] as const;

export type Permission = (typeof PERMISSIONS)[number]['code'];

/** `pcv` claim. Bump when PERMISSIONS grows so services know to refresh their catalog. */
export const PERMISSION_CATALOG_VERSION = 1;

const ALL: readonly Permission[] = PERMISSIONS.map((p) => p.code);

/** Built-in roles available in every organization (`roles.org_id IS NULL`). */
export const SYSTEM_ROLES = {
  owner: ALL,
  admin: ALL.filter((code) => code !== 'org:manage'),
  member: ['org:read', 'member:read', 'role:read'],
} as const satisfies Record<string, readonly Permission[]>;

export type SystemRoleKey = keyof typeof SYSTEM_ROLES;

export const permissionCatalog = (): PermissionCatalog => ({
  version: PERMISSION_CATALOG_VERSION,
  bitByCode: new Map(PERMISSIONS.map((p) => [p.code, p.bit])),
});
