import type { DataSourceOptions } from 'typeorm';
import { MIGRATIONS } from './migrations.js';

type EntityTarget = NonNullable<DataSourceOptions['entities']>;

/** Shared by the migration CLI and integration tests. The app uses TypeOrmModule instead. */
export function buildDataSourceOptions(
  url: string,
  extra: { entities?: EntityTarget } = {},
): DataSourceOptions {
  return {
    type: 'postgres',
    url,
    synchronize: false,
    migrations: MIGRATIONS,
    migrationsTableName: 'typeorm_migrations',
    entities: extra.entities ?? [],
    extra: { max: 5 },
  };
}
