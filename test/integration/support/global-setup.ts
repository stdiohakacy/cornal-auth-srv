import type { TestProject } from 'vitest/node';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from '../../../src/database/data-source-options.js';
import { assertLocalTestServer, TEST_SERVER_URL } from './test-db.js';

/**
 * Recreates `cornal_auth_<project>` and applies every migration once per run. One database per
 * Vitest project, so `pnpm test:all` can run integration and e2e side by side.
 */
export default async function setup(project: TestProject): Promise<void> {
  assertLocalTestServer(
    TEST_SERVER_URL,
    process.env['ALLOW_REMOTE_TEST_DATABASE'] === 'true',
  );
  const database = `cornal_auth_${project.name}`;
  const admin = new URL(TEST_SERVER_URL);
  admin.pathname = '/postgres';
  const target = new URL(TEST_SERVER_URL);
  target.pathname = `/${database}`;

  const adminSource = await new DataSource({
    type: 'postgres',
    url: admin.toString(),
  }).initialize();
  try {
    await adminSource.query(
      `DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`,
    );
    await adminSource.query(`CREATE DATABASE "${database}"`);
  } finally {
    await adminSource.destroy();
  }

  const migrator = await new DataSource(
    buildDataSourceOptions(target.toString()),
  ).initialize();
  try {
    await migrator.runMigrations({ transaction: 'each' });
  } finally {
    await migrator.destroy();
  }

  project.provide('databaseUrl', target.toString());
}
