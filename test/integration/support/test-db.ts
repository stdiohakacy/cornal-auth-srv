import { inject } from 'vitest';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from '../../../src/database/data-source-options.js';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

/** Base server URL; each Vitest project gets its own database (see global-setup.ts). */
export const TEST_SERVER_URL =
  process.env['TEST_DATABASE_URL'] ??
  'postgres://cornal_auth:cornal_auth@localhost:5432/cornal_auth';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', 'postgres']);

/**
 * Global setup DROPs and recreates databases on the target server: refuse anything that is not
 * obviously local unless ALLOW_REMOTE_TEST_DATABASE=true (e.g. a dedicated CI database host).
 */
export function assertLocalTestServer(url: string, allowRemote: boolean): void {
  const { hostname } = new URL(url);
  if (LOCAL_HOSTS.has(hostname) || allowRemote) return;
  throw new Error(
    `TEST_DATABASE_URL points to ${hostname}: refusing to drop databases on ${hostname}. ` +
      'Set ALLOW_REMOTE_TEST_DATABASE=true if this server is dedicated to tests.',
  );
}

/** URL of the database prepared for the current project by global setup. */
export const testDatabaseUrl = (): string => inject('databaseUrl');

/** A fresh DataSource against the current project's test database. */
export async function createTestDataSource(
  entities: NonNullable<
    Parameters<typeof buildDataSourceOptions>[1]
  >['entities'] = [],
): Promise<DataSource> {
  const dataSource = new DataSource(
    buildDataSourceOptions(testDatabaseUrl(), { entities }),
  );
  return dataSource.initialize();
}
