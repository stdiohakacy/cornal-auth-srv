import { testRedisUrl } from '../../integration/support/redis.js';
import type { ModuleMetadata, Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../../src/app.module.js';
import type { AppConfig } from '../../../src/config/env.schema.js';
import { testDatabaseUrl } from '../../integration/support/test-db.js';
import { configureHttp } from '../../../src/shared/infrastructure/http/configure-http.js';

/** Defaults for e2e apps; the database URL is injected per run by global setup. */
export const testConfig = (): AppConfig =>
  Object.freeze({
    NODE_ENV: 'test',
    APP_ROLE: 'login',
    PORT: 0,
    LOG_LEVEL: 'silent',
    TRUST_PROXY: 'loopback',
    // Per-project test database recreated by global setup; PgBouncer is not involved in tests.
    DATABASE_URL: testDatabaseUrl(),
    DATABASE_DIRECT_URL: testDatabaseUrl(),
    DB_POOL_MAX: 2,
    OUTBOX_RELAY_ENABLED: false,
    REDIS_URL: testRedisUrl(),
    NATS_URL: 'nats://localhost:4222',
    EMAIL_VERIFICATION_URL: 'http://localhost:3000/verify-email',
    APP_LOGIN_URL: 'http://localhost:3000/login',
    PASSWORD_RESET_URL: 'http://localhost:3000/reset-password',
    EMAIL_TRANSPORT: 'log',
    PASSWORD_BREACH_CHECK: false,
    EMAIL_FROM: 'Cornal <no-reply@cornal.local>',
  });

/** Boots the real HTTP pipeline (configureHttp) so e2e tests exercise production wiring. */
export async function createTestApp(
  overrides: Partial<AppConfig> = {},
  extra: {
    controllers?: Type[];
    imports?: NonNullable<ModuleMetadata['imports']>;
    providers?: { token: unknown; value: unknown }[];
  } = {},
): Promise<NestExpressApplication> {
  const config: AppConfig = Object.freeze({ ...testConfig(), ...overrides });
  let builder = Test.createTestingModule({
    imports: [AppModule.forRole(config), ...(extra.imports ?? [])],
    controllers: extra.controllers ?? [],
  });
  for (const { token, value } of extra.providers ?? []) {
    builder = builder.overrideProvider(token).useValue(value);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureHttp(app, config);
  await app.init();
  return app;
}
