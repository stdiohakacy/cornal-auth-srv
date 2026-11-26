import { randomUUIDv7 } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { createTestDataSource } from './support/test-db.js';

const CORE_TABLES = [
  'public.users',
  'public.password_credentials',
  'public.identities',
  'public.one_time_tokens',
  'public.mfa_factors',
  'public.mfa_recovery_codes',
  'public.organizations',
  'public.memberships',
  'public.permissions',
  'public.roles',
  'public.role_permissions',
  'public.membership_roles',
  'public.sessions',
  'public.revocation_events',
  'public.audit_logs',
  'nest_outbox.messages',
];

async function existingTables(db: DataSource): Promise<string[]> {
  const rows: { name: string }[] = await db.query(
    `SELECT table_schema || '.' || table_name AS name FROM information_schema.tables
      WHERE table_schema IN ('public', 'nest_outbox')`,
  );
  return rows.map((r) => r.name);
}

async function seedTenantAndMember(db: DataSource) {
  const orgA = randomUUIDv7();
  const orgB = randomUUIDv7();
  const user = randomUUIDv7();
  const membership = randomUUIDv7();
  await db.query(`INSERT INTO users (id, email) VALUES ($1, $2)`, [
    user,
    `${user}@test.local`,
  ]);
  await db.query(
    `INSERT INTO organizations (id, slug, name) VALUES ($1, $2, 'A'), ($3, $4, 'B')`,
    [orgA, `a-${orgA}`, orgB, `b-${orgB}`],
  );
  await db.query(
    `INSERT INTO memberships (id, org_id, user_id) VALUES ($1, $2, $3)`,
    [membership, orgA, user],
  );
  return { orgA, orgB, membership };
}

describe('database schema', () => {
  let db: DataSource;

  beforeAll(async () => {
    db = await createTestDataSource();
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('creates every core table', async () => {
    expect(await existingTables(db)).toEqual(
      expect.arrayContaining(CORE_TABLES),
    );
  });

  it('audit row for now() lands in a monthly partition, not default', async () => {
    const [row]: { partition: string }[] = await db.query(
      `INSERT INTO audit_logs (id, occurred_at, action, outcome) VALUES ($1, now(), 'test.event', 'success')
       RETURNING tableoid::regclass::text AS partition`,
      [randomUUIDv7()],
    );
    expect(row?.partition).toMatch(/^audit_logs_\d{4}_\d{2}$/);
  });

  it("rejects assigning another tenant's custom role", async () => {
    const { orgB, membership } = await seedTenantAndMember(db);
    const role = randomUUIDv7();
    await db.query(
      `INSERT INTO roles (id, org_id, key, name) VALUES ($1, $2, 'b-admin', 'B admin')`,
      [role, orgB],
    );

    await expect(
      db.query(
        `INSERT INTO membership_roles (membership_id, role_id) VALUES ($1, $2)`,
        [membership, role],
      ),
    ).rejects.toMatchObject({ driverError: { code: '23514' } });
  });

  it('allows assigning a system role (org_id NULL)', async () => {
    const { membership } = await seedTenantAndMember(db);
    const role = randomUUIDv7();
    await db.query(
      `INSERT INTO roles (id, org_id, key, name) VALUES ($1, NULL, $2, 'System')`,
      [role, `sys-${role}`],
    );

    await expect(
      db.query(
        `INSERT INTO membership_roles (membership_id, role_id) VALUES ($1, $2)`,
        [membership, role],
      ),
    ).resolves.toBeDefined();
  });

  it('reverting every migration leaves no app tables, re-running restores them', async () => {
    const migrator = await createTestDataSource();
    try {
      while (
        (await migrator.query(`SELECT 1 FROM typeorm_migrations LIMIT 1`))
          .length > 0
      ) {
        await migrator.undoLastMigration({ transaction: 'each' });
      }
      const afterRevert = await existingTables(migrator);
      expect(afterRevert.filter((t) => CORE_TABLES.includes(t))).toEqual([]);

      await migrator.runMigrations({ transaction: 'each' });
      expect(await existingTables(migrator)).toEqual(
        expect.arrayContaining(CORE_TABLES),
      );
    } finally {
      await migrator.destroy();
    }
  });
});
