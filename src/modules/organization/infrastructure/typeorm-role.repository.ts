import type { DataSource, EntityManager } from 'typeorm';
import type { Permission } from '../../../contracts/permissions.js';
import { first } from '../../../shared/domain/guard.js';
import {
  isForeignKeyViolation,
  isUniqueViolation,
} from '../../../shared/infrastructure/persistence/pg-errors.js';
import type { TransactionContext } from '../../../shared/infrastructure/persistence/transaction-context.js';
import type { RoleRepository } from '../application/ports.js';
import type { RoleId } from '../domain/membership.js';
import {
  RoleInUseError,
  RoleKeyTakenError,
} from '../domain/organization.errors.js';
import { PermissionSet, Role, RoleKey } from '../domain/role.js';

type RoleRow = {
  id: string;
  org_id: string;
  key: string;
  name: string;
  created_at: Date;
  permissions: string[];
};

/**
 * Custom roles (org_id = the org). `roles` has no version column: updates are last-writer-wins on
 * `name`, and the role_permissions diff is idempotent.
 */
export class TypeOrmRoleRepository implements RoleRepository {
  constructor(
    private readonly dataSource: DataSource,
    private readonly tx: TransactionContext,
  ) {}

  async findInOrg(orgId: string, roleId: string): Promise<Role | undefined> {
    const manager = this.tx.active?.manager ?? this.dataSource.manager;
    const rows: RoleRow[] = await manager.query(
      `SELECT r.id, r.org_id, r.key, r.name, r.created_at,
         COALESCE(array_agg(rp.permission_code ORDER BY rp.permission_code)
           FILTER (WHERE rp.permission_code IS NOT NULL), '{}') AS permissions
       FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id
       WHERE r.id = $1 AND r.org_id = $2
       GROUP BY r.id`,
      [roleId, orgId],
    );
    const row = first(rows);
    return row
      ? Role.reconstitute(
          row.id as RoleId,
          {
            orgId: row.org_id,
            key: RoleKey.fromPersistence(row.key),
            name: row.name,
            // codes come from role_permissions → permissions(code), synced from the code catalog
            permissions: new PermissionSet(row.permissions as Permission[]),
            createdAt: row.created_at,
          },
          1,
        )
      : undefined;
  }

  async save(role: Role): Promise<void> {
    const manager = this.tx.requireManager();
    try {
      await manager.query(
        `INSERT INTO roles (id, org_id, key, name, created_at) VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
        [role.id, role.orgId, role.key.value, role.name],
      );
    } catch (error) {
      if (isUniqueViolation(error, 'roles_org_key_uq'))
        throw new RoleKeyTakenError();
      throw error;
    }
    await this.writePermissionDiff(manager, role);
    role.markPersisted();
    this.tx.track(role);
  }

  async delete(role: Role): Promise<void> {
    try {
      await this.tx
        .requireManager()
        .query('DELETE FROM roles WHERE id = $1 AND org_id = $2', [
          role.id,
          role.orgId,
        ]);
    } catch (error) {
      if (isForeignKeyViolation(error)) throw new RoleInUseError(); // membership_roles ON DELETE RESTRICT
      throw error;
    }
  }

  private async writePermissionDiff(
    manager: EntityManager,
    role: Role,
  ): Promise<void> {
    const { added, removed } = role.permissions;
    if (removed.length > 0) {
      await manager.query(
        'DELETE FROM role_permissions WHERE role_id = $1 AND permission_code = ANY($2::text[])',
        [role.id, removed],
      );
    }
    if (added.length > 0) {
      await manager.query(
        `INSERT INTO role_permissions (role_id, permission_code)
         SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING`,
        [role.id, added],
      );
    }
  }
}
