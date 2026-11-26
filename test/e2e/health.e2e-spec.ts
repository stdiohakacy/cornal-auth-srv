import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import type { AppConfig } from '../../src/config/env.schema.js';
import { ReadinessRegistry } from '../../src/health/readiness.registry.js';

const config: AppConfig = Object.freeze({
  NODE_ENV: 'test',
  APP_ROLE: 'login',
  PORT: 0,
  LOG_LEVEL: 'info',
  DATABASE_URL: 'postgres://u:p@localhost:6432/db',
  DATABASE_DIRECT_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  NATS_URL: 'nats://localhost:4222',
});

async function createApp(): Promise<INestApplication<App>> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRole(config)],
  }).compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
  await app.init();
  return app;
}

describe('GET /health (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    app = await createApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('reports ok and the running role', async () => {
    await request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok', role: 'login' });
  });

  it('readiness is ok when every registered dependency is up', async () => {
    app.get(ReadinessRegistry).register('postgres', async () => true);

    const res = await request(app.getHttpServer()).get('/health/ready');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      info: { postgres: { status: 'up' } },
    });
  });

  it('readiness returns 503 and names the failing dependency', async () => {
    const registry = app.get(ReadinessRegistry);
    registry.register('postgres', async () => true);
    registry.register('redis', async () => {
      throw new Error('ECONNREFUSED');
    });

    const res = await request(app.getHttpServer()).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      status: 'error',
      error: { redis: { status: 'down' } },
      info: { postgres: { status: 'up' } },
    });
  });

  it('liveness stays 200 while a dependency is down', async () => {
    app.get(ReadinessRegistry).register('redis', async () => false);

    await request(app.getHttpServer()).get('/health').expect(200);
  });
});
