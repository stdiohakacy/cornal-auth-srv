import type { DataSource } from 'typeorm';
import { first } from '../../../shared/domain/guard.js';
import type { OrganizationReads } from '../application/ports.js';

export type MembershipContextRow = {
  readonly membershipId: string;
  readonly authzVersion: number;
  readonly authzEpoch: number;
  readonly mfaRequired: boolean;
  readonly permissions: readonly string[];
};

export type MyOrganizationRow = {
  readonly orgId: string;
  readonly slug: string;
  readonly name: string;
  readonly roleKeys: readonly string[];
};

export type MemberRow = {
  readonly membershipId: string;
  readonly userId: string;
  readonly status: string;
  readonly roleKeys: readonly string[];
};

/** Read side for tokens and listings (plain SQL, no aggregates). */
export class OrganizationQueries implements OrganizationReads {
  constructor(private readonly dataSource: DataSource) {}

  /** Active member of an active org → effective permissions (union over roles). */
  async membershipContext(
    userId: string,
    orgId: string,
  ): Promise<MembershipContextRow | undefined> {
    const rows: {
      id: string;
      authz_version: number;
      authz_epoch: number;
      mfa_required: boolean;
      permissions: string[];
    }[] = await this.dataSource.query(
      `SELECT m.id, m.authz_version, o.authz_epoch, o.mfa_required,
         COALESCE(array_agg(DISTINCT rp.permission_code) FILTER (WHERE rp.permission_code IS NOT NULL), '{}')
           AS permissions
       FROM memberships m
       JOIN organizations o ON o.id = m.org_id
       LEFT JOIN membership_roles mr ON mr.membership_id = m.id
       LEFT JOIN role_permissions rp ON rp.role_id = mr.role_id
       WHERE m.user_id = $1 AND m.org_id = $2 AND m.status = 'active' AND o.status = 'active'
       GROUP BY m.id, o.authz_epoch, o.mfa_required`,
      [userId, orgId],
    );
    const row = first(rows);
    return row
      ? {
          membershipId: row.id,
          authzVersion: row.authz_version,
          authzEpoch: row.authz_epoch,
          mfaRequired: row.mfa_required,
          permissions: row.permissions,
        }
      : undefined;
  }

  async activeMembershipsOf(userId: string): Promise<MyOrganizationRow[]> {
    const rows: {
      org_id: string;
      slug: string;
      name: string;
      role_keys: string[];
    }[] = await this.dataSource.query(
      `SELECT o.id AS org_id, o.slug, o.name,
         COALESCE(array_agg(r.key ORDER BY r.key) FILTER (WHERE r.key IS NOT NULL), '{}') AS role_keys
       FROM memberships m
       JOIN organizations o ON o.id = m.org_id
       LEFT JOIN membership_roles mr ON mr.membership_id = m.id
       LEFT JOIN roles r ON r.id = mr.role_id
       WHERE m.user_id = $1 AND m.status = 'active' AND o.status = 'active'
       GROUP BY o.id ORDER BY o.name, o.id`,
      [userId],
    );
    return rows.map((r) => ({
      orgId: r.org_id,
      slug: r.slug,
      name: r.name,
      roleKeys: r.role_keys,
    }));
  }

  async membersOf(orgId: string): Promise<MemberRow[]> {
    const rows: {
      id: string;
      user_id: string;
      status: string;
      role_keys: string[];
    }[] = await this.dataSource.query(
      `SELECT m.id, m.user_id, m.status,
         COALESCE(array_agg(r.key ORDER BY r.key) FILTER (WHERE r.key IS NOT NULL), '{}') AS role_keys
       FROM memberships m
       LEFT JOIN membership_roles mr ON mr.membership_id = m.id
       LEFT JOIN roles r ON r.id = mr.role_id
       WHERE m.org_id = $1
       GROUP BY m.id ORDER BY m.created_at, m.id`,
      [orgId],
    );
    return rows.map((r) => ({
      membershipId: r.id,
      userId: r.user_id,
      status: r.status,
      roleKeys: r.role_keys,
    }));
  }
}
