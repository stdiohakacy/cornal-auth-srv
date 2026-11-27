import type { ModuleMetadata } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { AppConfigModule } from '../../../src/config/app-config.module.js';
import type { AppConfig } from '../../../src/config/env.schema.js';
import { HealthModule } from '../../../src/health/health.module.js';
import { PersistenceModule } from '../../../src/shared/infrastructure/persistence/persistence.module.js';
import { RequestContextModule } from '../../../src/shared/infrastructure/request-context/request-context.module.js';
import { testRedisUrl } from './redis.js';
import { testDatabaseUrl } from './test-db.js';

/** Config for integration modules; the DB and Redis URLs come from global setup. */
export const integrationConfig = (
  overrides: Partial<AppConfig> = {},
): AppConfig =>
  Object.freeze({
    NODE_ENV: 'test',
    APP_ROLE: 'worker',
    PORT: 0,
    LOG_LEVEL: 'silent',
    TRUST_PROXY: false,
    DATABASE_URL: testDatabaseUrl(),
    DATABASE_DIRECT_URL: testDatabaseUrl(),
    DB_POOL_MAX: 4,
    OUTBOX_RELAY_ENABLED: false,
    REDIS_URL: testRedisUrl(),
    NATS_URL: 'nats://localhost:4222',
    EMAIL_VERIFICATION_URL: 'http://localhost:3000/verify-email',
    APP_LOGIN_URL: 'http://localhost:3000/login',
    PASSWORD_RESET_URL: 'http://localhost:3000/reset-password',
    EMAIL_TRANSPORT: 'log',
    PASSWORD_BREACH_CHECK: false,
    EMAIL_FROM: 'Cornal <no-reply@cornal.local>',
    ...overrides,
  });

/** Persistence stack only (no HTTP). The relay is off: tests drive it with `runOnce()`. */
export async function createPersistenceApp(
  extra: {
    config?: Partial<AppConfig>;
    imports?: NonNullable<ModuleMetadata['imports']>;
    providers?: { token: unknown; value: unknown }[];
  } = {},
): Promise<TestingModule> {
  let builder = Test.createTestingModule({
    imports: [
      AppConfigModule.forRoot(integrationConfig(extra.config)),
      RequestContextModule,
      HealthModule,
      PersistenceModule,
      ...(extra.imports ?? []),
    ],
  });
  for (const { token, value } of extra.providers ?? []) {
    builder = builder.overrideProvider(token).useValue(value);
  }
  const moduleRef = await builder.compile();
  await moduleRef.init();
  return moduleRef;
}
