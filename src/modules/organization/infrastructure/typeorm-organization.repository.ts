import type { DataSource, EntityManager } from 'typeorm';
import { ConcurrencyConflictError } from '../../../shared/domain/concurrency-conflict.error.js';
import { first } from '../../../shared/domain/guard.js';
import { isUniqueViolation } from '../../../shared/infrastructure/persistence/pg-errors.js';
import type { TransactionContext } from '../../../shared/infrastructure/persistence/transaction-context.js';
import type { OrganizationRepository } from '../application/ports.js';
import { SlugTakenError } from '../domain/organization.errors.js';
import {
  Organization,
  type OrganizationId,
  type OrganizationStatus,
} from '../domain/organization.js';
import { Slug } from '../domain/slug.js';

type OrganizationRow = {
  id: string;
  slug: string;
  name: string;
  status: OrganizationStatus;
  authz_epoch: number;
  mfa_required: boolean;
  created_at: Date;
  version: number;
};

export class TypeOrmOrganizationRepository implements OrganizationRepository {
  constructor(
    private readonly dataSource: DataSource,
    private readonly tx: TransactionContext,
  ) {}

  async findById(id: OrganizationId): Promise<Organization | undefined> {
    const manager = this.tx.active?.manager ?? this.dataSource.manager;
    const rows: OrganizationRow[] = await manager.query(
      `SELECT id, slug, name, status, authz_epoch, mfa_required, created_at, version
       FROM organizations WHERE id = $1`,
      [id],
    );
    const row = first(rows);
    return row
      ? Organization.reconstitute(
          row.id as OrganizationId,
          {
            slug: Slug.fromPersistence(row.slug),
            name: row.name,
            status: row.status,
            authzEpoch: row.authz_epoch,
            mfaRequired: row.mfa_required,
            createdAt: row.created_at,
          },
          row.version,
        )
      : undefined;
  }

  async save(org: Organization): Promise<void> {
    const manager = this.tx.requireManager();
    if (org.version === 0) await this.insert(manager, org);
    else await this.update(manager, org);
    org.markPersisted();
    this.tx.track(org);
  }

  private async insert(
    manager: EntityManager,
    org: Organization,
  ): Promise<void> {
    const o = org.snapshot;
    try {
      await manager.query(
        `INSERT INTO organizations (id, slug, name, status, authz_epoch, mfa_required, created_at, version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 1)`,
        [
          org.id,
          o.slug.value,
          o.name,
          o.status,
          o.authzEpoch,
          o.mfaRequired,
          o.createdAt,
        ],
      );
    } catch (error) {
      if (isUniqueViolation(error, 'organizations_slug_key'))
        throw new SlugTakenError();
      throw error;
    }
  }

  private async update(
    manager: EntityManager,
    org: Organization,
  ): Promise<void> {
    const o = org.snapshot;
    const [, affected]: [unknown, number] = await manager.query(
      `UPDATE organizations SET name = $3, status = $4, authz_epoch = $5, mfa_required = $6, version = version + 1
       WHERE id = $1 AND version = $2`,
      [org.id, org.version, o.name, o.status, o.authzEpoch, o.mfaRequired],
    );
    if (affected !== 1)
      throw new ConcurrencyConflictError('Organization', org.id);
  }
}
