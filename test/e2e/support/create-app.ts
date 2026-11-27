import { testRedisUrl } from '../../integration/support/redis.js';
import type { ModuleMetadata, Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../../src/app.module.js';
import type { AppConfig } from '../../../src/config/env.schema.js';
import { buildTestConfig } from '../../../src/config/test-config.test-support.js';
import { testDatabaseUrl } from '../../integration/support/test-db.js';
import { configureHttp } from '../../../src/shared/infrastructure/http/configure-http.js';

/** Defaults for e2e apps; the database and Redis URLs are injected per run by global setup. */
export const testConfig = (): AppConfig =>
  buildTestConfig({
    APP_ROLE: 'login',
    PORT: 0,
    TRUST_PROXY: 'loopback',
    DATABASE_URL: testDatabaseUrl(),
    DATABASE_DIRECT_URL: testDatabaseUrl(),
    REDIS_URL: testRedisUrl(),
    DB_POOL_MAX: 2,
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
