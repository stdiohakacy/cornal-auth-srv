import { randomUUIDv7 } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import {
  PERMISSIONS,
  SYSTEM_ROLES,
  type SystemRoleKey,
} from '../../../contracts/permissions.js';
import { InvariantViolation } from '../../../shared/domain/domain-error.js';
import { first } from '../../../shared/domain/guard.js';

export type SystemRoleIds = Readonly<Record<SystemRoleKey, string>>;

const ROLE_NAMES: Readonly<Record<SystemRoleKey, string>> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
};

/**
 * Makes the database match the code catalog (idempotent): permissions are upserted, a bit that
 * differs from code fails startup, system roles exist with exactly their catalog permissions.
 * Returns the system role ids. Must run inside a transaction.
 *
 * Pods booting together are serialized by a transaction-scoped advisory lock (released at
 * commit/rollback, so safe through PgBouncer transaction pooling). Without it, two concurrent
 * `ON CONFLICT (code)` inserts can both pass the arbiter pre-check and then collide on the other
 * unique index (bit_index), which ON CONFLICT does not handle.
 */
export async function syncPermissionCatalog(
  manager: EntityManager,
): Promise<SystemRoleIds> {
  await manager.query(
    "SELECT pg_advisory_xact_lock(hashtext('cornal-auth:permission-catalog-sync'))",
  );
  for (const { code, bit, description } of PERMISSIONS) {
    const rows: { bit_index: number }[] = await manager.query(
      `INSERT INTO permissions (code, bit_index, service, description) VALUES ($1, $2, 'auth', $3)
       ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description
       RETURNING bit_index`,
      [code, bit, description],
    );
    const stored = first(rows)?.bit_index;
    if (stored !== bit) {
      throw new InvariantViolation(
        `Permission ${code} has bit ${String(stored)} in the database but ${bit} in code: bits are append-only`,
      );
    }
  }

  const ids: Partial<Record<SystemRoleKey, string>> = {};
  for (const key of Object.keys(SYSTEM_ROLES) as SystemRoleKey[]) {
    await manager.query(
      `INSERT INTO roles (id, org_id, key, name) VALUES ($1, NULL, $2, $3)
       ON CONFLICT ON CONSTRAINT roles_org_key_uq DO NOTHING`,
      [randomUUIDv7(), key, ROLE_NAMES[key]],
    );
    const rows: { id: string }[] = await manager.query(
      'SELECT id FROM roles WHERE org_id IS NULL AND key = $1',
      [key],
    );
    const roleId = first(rows)?.id;
    if (roleId === undefined)
      throw new InvariantViolation(`System role ${key} was not created`);
    const codes: readonly string[] = SYSTEM_ROLES[key];
    await manager.query(
      'DELETE FROM role_permissions WHERE role_id = $1 AND NOT (permission_code = ANY($2::text[]))',
      [roleId, codes],
    );
    await manager.query(
      `INSERT INTO role_permissions (role_id, permission_code)
       SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING`,
      [roleId, codes],
    );
    ids[key] = roleId;
  }
  const { owner, admin, member } = ids;
  if (owner === undefined || admin === undefined || member === undefined) {
    throw new InvariantViolation('System roles incomplete after sync');
  }
  return { owner, admin, member };
}
