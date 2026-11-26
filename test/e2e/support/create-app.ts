import type { Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../../src/app.module.js';
import type { AppConfig } from '../../../src/config/env.schema.js';
import { configureHttp } from '../../../src/shared/infrastructure/http/configure-http.js';

export const testConfig: AppConfig = Object.freeze({
  NODE_ENV: 'test',
  APP_ROLE: 'login',
  PORT: 0,
  LOG_LEVEL: 'silent',
  TRUST_PROXY: 'loopback',
  DATABASE_URL: 'postgres://u:p@localhost:6432/db',
  DATABASE_DIRECT_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  NATS_URL: 'nats://localhost:4222',
});

/** Boots the real HTTP pipeline (configureHttp) so e2e tests exercise production wiring. */
export async function createTestApp(
  overrides: Partial<AppConfig> = {},
  extra: { controllers?: Type[] } = {},
): Promise<NestExpressApplication> {
  const config: AppConfig = Object.freeze({ ...testConfig, ...overrides });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRole(config)],
    controllers: extra.controllers ?? [],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureHttp(app, config);
  await app.init();
  return app;
}
