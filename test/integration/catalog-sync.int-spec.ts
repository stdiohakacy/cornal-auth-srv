import type { DataSource } from 'typeorm';
import { PERMISSIONS, SYSTEM_ROLES } from '../../src/contracts/permissions.js';
import { syncPermissionCatalog } from '../../src/modules/access-control/infrastructure/catalog-sync.js';
import { createTestDataSource } from './support/test-db.js';

describe('permission catalog sync (integration)', () => {
  let db: DataSource;
  const sync = () =>
    db.transaction((manager) => syncPermissionCatalog(manager));

  beforeAll(async () => {
    db = await createTestDataSource();
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('pods booting together on an empty catalog all sync successfully', async () => {
    // Both inserts must pass ON CONFLICT's pre-check before either lands: a narrow window, so
    // repeat. role_permissions cascades; each round rebuilds everything (files run sequentially).
    for (let round = 0; round < 25; round += 1) {
      await db.query('TRUNCATE permissions CASCADE');

      const results = await Promise.allSettled([
        sync(),
        sync(),
        sync(),
        sync(),
      ]);

      expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    }
  });

  it('sync is idempotent (twice → same rows)', async () => {
    const first = await sync();
    const second = await sync();

    expect(second).toEqual(first);
    const [{ n }]: [{ n: number }] = await db.query(
      'SELECT count(*)::int AS n FROM permissions',
    );
    expect(n).toBe(PERMISSIONS.length);
    const [{ roles }]: [{ roles: number }] = await db.query(
      'SELECT count(*)::int AS roles FROM roles WHERE org_id IS NULL',
    );
    expect(roles).toBe(Object.keys(SYSTEM_ROLES).length);
  });

  it('system roles get exactly their permissions', async () => {
    const ids = await sync();

    for (const [key, codes] of Object.entries(SYSTEM_ROLES)) {
      const rows: { permission_code: string }[] = await db.query(
        'SELECT permission_code FROM role_permissions WHERE role_id = $1 ORDER BY 1',
        [ids[key as keyof typeof SYSTEM_ROLES]],
      );
      expect(rows.map((r) => r.permission_code)).toEqual([...codes].sort());
    }
  });

  it('a DB bit that differs from code → throws', async () => {
    await sync();
    await db.query(
      `UPDATE permissions SET bit_index = 1999 WHERE code = 'audit:read'`,
    );
    try {
      await expect(sync()).rejects.toThrow(/audit:read/);
    } finally {
      await db.query(
        `UPDATE permissions SET bit_index = 7 WHERE code = 'audit:read'`,
      );
    }
  });
});
