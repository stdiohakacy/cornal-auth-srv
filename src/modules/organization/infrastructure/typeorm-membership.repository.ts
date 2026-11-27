import type { DataSource, EntityManager } from 'typeorm';
import { ConcurrencyConflictError } from '../../../shared/domain/concurrency-conflict.error.js';
import { first } from '../../../shared/domain/guard.js';
import type { TransactionContext } from '../../../shared/infrastructure/persistence/transaction-context.js';
import type { MembershipRepository } from '../application/ports.js';
import {
  Membership,
  type MembershipId,
  type MembershipStatus,
  type RoleId,
  RoleSet,
} from '../domain/membership.js';

type MembershipRow = {
  id: string;
  org_id: string;
  user_id: string;
  status: MembershipStatus;
  authz_version: number;
  created_at: Date;
  version: number;
  role_ids: string[];
};

export class TypeOrmMembershipRepository implements MembershipRepository {
  constructor(
    private readonly dataSource: DataSource,
    private readonly tx: TransactionContext,
  ) {}

  async findById(id: MembershipId): Promise<Membership | undefined> {
    return this.findOne('m.id = $1', [id]);
  }

  async findByOrgAndUser(
    orgId: string,
    userId: string,
  ): Promise<Membership | undefined> {
    return this.findOne('m.org_id = $1 AND m.user_id = $2', [orgId, userId]);
  }

  async delete(membership: Membership): Promise<void> {
    const [, affected]: [unknown, number] = await this.tx
      .requireManager()
      .query('DELETE FROM memberships WHERE id = $1 AND version = $2', [
        membership.id,
        membership.version,
      ]);
    if (affected !== 1)
      throw new ConcurrencyConflictError('Membership', membership.id);
  }

  private async findOne(
    where: string,
    params: unknown[],
  ): Promise<Membership | undefined> {
    const manager = this.tx.active?.manager ?? this.dataSource.manager;
    const rows: MembershipRow[] = await manager.query(
      `SELECT m.id, m.org_id, m.user_id, m.status, m.authz_version, m.created_at, m.version,
         COALESCE(array_agg(mr.role_id ORDER BY mr.granted_at, mr.role_id) FILTER (WHERE mr.role_id IS NOT NULL), '{}')
           AS role_ids
       FROM memberships m LEFT JOIN membership_roles mr ON mr.membership_id = m.id
       WHERE ${where}
       GROUP BY m.id`,
      params,
    );
    const row = first(rows);
    return row
      ? Membership.reconstitute(
          row.id as MembershipId,
          {
            orgId: row.org_id,
            userId: row.user_id,
            status: row.status,
            roles: new RoleSet(row.role_ids as RoleId[]),
            authzVersion: row.authz_version,
            createdAt: row.created_at,
          },
          row.version,
        )
      : undefined;
  }

  async save(membership: Membership): Promise<void> {
    const manager = this.tx.requireManager();
    if (membership.version === 0) await this.insert(manager, membership);
    else await this.update(manager, membership);
    await this.writeRoleDiff(manager, membership);
    membership.markPersisted();
    this.tx.track(membership);
  }

  private async insert(manager: EntityManager, m: Membership): Promise<void> {
    await manager.query(
      `INSERT INTO memberships (id, org_id, user_id, status, authz_version, created_at, version)
       VALUES ($1, $2, $3, $4, $5, $6, 1)`,
      [m.id, m.orgId, m.userId, m.status, m.authzVersion, m.createdAt],
    );
  }

  private async update(manager: EntityManager, m: Membership): Promise<void> {
    const [, affected]: [unknown, number] = await manager.query(
      `UPDATE memberships SET status = $3, authz_version = $4, version = version + 1
       WHERE id = $1 AND version = $2`,
      [m.id, m.version, m.status, m.authzVersion],
    );
    if (affected !== 1) throw new ConcurrencyConflictError('Membership', m.id);
  }

  /** Only the diff hits the table; the cross-tenant trigger guards every inserted row. */
  private async writeRoleDiff(
    manager: EntityManager,
    m: Membership,
  ): Promise<void> {
    if (m.roles.removed.length > 0) {
      await manager.query(
        'DELETE FROM membership_roles WHERE membership_id = $1 AND role_id = ANY($2::uuid[])',
        [m.id, m.roles.removed],
      );
    }
    if (m.roles.added.length > 0) {
      await manager.query(
        `INSERT INTO membership_roles (membership_id, role_id)
         SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
        [m.id, m.roles.added],
      );
    }
  }
}
