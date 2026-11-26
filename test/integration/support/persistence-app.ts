import { Test, type TestingModule } from '@nestjs/testing';
import { AppConfigModule } from '../../../src/config/app-config.module.js';
import type { AppConfig } from '../../../src/config/env.schema.js';
import { HealthModule } from '../../../src/health/health.module.js';
import { PersistenceModule } from '../../../src/shared/infrastructure/persistence/persistence.module.js';
import { RequestContextModule } from '../../../src/shared/infrastructure/request-context/request-context.module.js';
import { testDatabaseUrl } from './test-db.js';

/** Persistence stack only (no HTTP). The relay is off: tests drive it with `runOnce()`. */
export async function createPersistenceApp(): Promise<TestingModule> {
  const config: AppConfig = Object.freeze({
    NODE_ENV: 'test',
    APP_ROLE: 'worker',
    PORT: 0,
    LOG_LEVEL: 'silent',
    TRUST_PROXY: false,
    DATABASE_URL: testDatabaseUrl(),
    DATABASE_DIRECT_URL: testDatabaseUrl(),
    DB_POOL_MAX: 4,
    OUTBOX_RELAY_ENABLED: false,
    REDIS_URL: 'redis://localhost:6379',
    NATS_URL: 'nats://localhost:4222',
  });
  const moduleRef = await Test.createTestingModule({
    imports: [
      AppConfigModule.forRoot(config),
      RequestContextModule,
      HealthModule,
      PersistenceModule,
    ],
  }).compile();
  await moduleRef.init();
  return moduleRef;
}
