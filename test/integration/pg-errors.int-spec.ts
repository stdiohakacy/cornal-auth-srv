import { randomUUIDv7 } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { isUniqueViolation } from '../../src/shared/infrastructure/persistence/pg-errors.js';
import { createTestDataSource } from './support/test-db.js';

describe('isUniqueViolation', () => {
  let db: DataSource;

  beforeAll(async () => {
    db = await createTestDataSource();
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('isUniqueViolation true for duplicate key, matching constraint name', async () => {
    const slug = `dup-${randomUUIDv7()}`;
    await db.query(
      `INSERT INTO organizations (id, slug, name) VALUES ($1, $2, 'x')`,
      [randomUUIDv7(), slug],
    );

    const error: unknown = await db
      .query(
        `INSERT INTO organizations (id, slug, name) VALUES ($1, $2, 'y')`,
        [randomUUIDv7(), slug],
      )
      .catch((e: unknown) => e);

    expect(isUniqueViolation(error)).toBe(true);
    expect(isUniqueViolation(error, 'organizations_slug_key')).toBe(true);
    expect(isUniqueViolation(error, 'other_constraint')).toBe(false);
  });

  it('false for other errors', async () => {
    const error: unknown = await db
      .query('SELECT * FROM no_such_table')
      .catch((e: unknown) => e);

    expect(isUniqueViolation(error)).toBe(false);
    expect(isUniqueViolation(new Error('plain'))).toBe(false);
  });
});
