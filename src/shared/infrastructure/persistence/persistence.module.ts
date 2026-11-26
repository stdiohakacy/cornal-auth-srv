import { Global, Inject, Module, type OnModuleInit } from '@nestjs/common';
import { OutboxModule, OutboxStorage } from '@nestjs/outbox';
import { fromTypeOrm, PostgresOutboxStore } from '@nestjs/outbox/postgres';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { APP_CONFIG, type AppConfig } from '../../../config/env.schema.js';
import { ReadinessRegistry } from '../../../health/readiness.registry.js';
import { UNIT_OF_WORK } from '../../application/ports.js';
import { OUTBOX_RETRY, OutboxDeadLetterAlerts } from './outbox-policy.js';
import { TransactionContext } from './transaction-context.js';
import { TypeOrmUnitOfWork } from './typeorm-unit-of-work.js';

/**
 * PostgreSQL through PgBouncer (DATABASE_URL), the Unit of Work, the transactional outbox stored in
 * the same database, and the `postgres` readiness probe. Migrations are NOT run here: `pnpm db:migrate`.
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        type: 'postgres',
        url: config.DATABASE_URL,
        autoLoadEntities: true,
        synchronize: false,
        migrationsRun: false,
        retryAttempts: 3,
        extra: { max: config.DB_POOL_MAX },
      }),
    }),
    OutboxModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        relay: { enabled: config.OUTBOX_RELAY_ENABLED, pollInterval: '250ms' },
        retry: OUTBOX_RETRY,
      }),
    }),
  ],
  providers: [
    { provide: TransactionContext, useValue: new TransactionContext() },
    { provide: UNIT_OF_WORK, useClass: TypeOrmUnitOfWork },
    OutboxDeadLetterAlerts,
    {
      provide: PostgresOutboxStore,
      inject: [DataSource, OutboxStorage],
      useFactory: (dataSource: DataSource, storage: OutboxStorage) =>
        new PostgresOutboxStore(
          { executor: fromTypeOrm(dataSource), migrate: false },
          storage,
        ),
    },
  ],
  exports: [TransactionContext, UNIT_OF_WORK],
})
export class PersistenceModule implements OnModuleInit {
  constructor(
    @Inject(DataSource) private readonly dataSource: DataSource,
    private readonly readiness: ReadinessRegistry,
  ) {}

  onModuleInit(): void {
    this.readiness.register('postgres', async () => {
      await this.dataSource.query('SELECT 1');
      return true;
    });
  }
}
