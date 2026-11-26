import { existsSync } from 'node:fs';
import { DataSource } from 'typeorm';
import { parseConfig } from '../config/env.schema.js';
import { buildDataSourceOptions } from './data-source-options.js';

/**
 * `pnpm db:migrate` applies pending migrations; `pnpm db:revert` undoes the last one.
 * Always connects to DATABASE_DIRECT_URL: DDL never goes through PgBouncer.
 */
async function main(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const config = parseConfig(process.env);
  if (!config.ok) {
    process.stderr.write(
      `Invalid environment configuration:\n${config.error}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const dataSource = await new DataSource(
    buildDataSourceOptions(config.value.DATABASE_DIRECT_URL),
  ).initialize();
  try {
    if (process.argv.includes('--revert')) {
      await dataSource.undoLastMigration({ transaction: 'each' });
      process.stdout.write('Reverted the last migration\n');
    } else {
      const applied = await dataSource.runMigrations({ transaction: 'each' });
      process.stdout.write(
        `Applied ${applied.length} migration(s)${applied.map((m) => `\n  - ${m.name}`).join('')}\n`,
      );
    }
  } finally {
    await dataSource.destroy();
  }
}

await main();
