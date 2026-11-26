import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { ReadinessRegistry } from '../../src/health/readiness.registry.js';
import { createTestApp } from './support/create-app.js';

describe('GET /health (e2e)', () => {
  let app: NestExpressApplication;

  beforeEach(async () => {
    app = await createTestApp();
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
    app.get(ReadinessRegistry).register('fake-db', async () => true);

    const res = await request(app.getHttpServer()).get('/health/ready');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      info: { 'fake-db': { status: 'up' } },
    });
  });

  it('readiness returns 503 and names the failing dependency', async () => {
    const registry = app.get(ReadinessRegistry);
    registry.register('fake-db', async () => true);
    registry.register('fake-cache', async () => {
      throw new Error('ECONNREFUSED');
    });

    const res = await request(app.getHttpServer()).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      status: 'error',
      error: { 'fake-cache': { status: 'down' } },
      info: { 'fake-db': { status: 'up' } },
    });
  });

  it('readiness reports postgres up from the real database', async () => {
    const res = await request(app.getHttpServer()).get('/health/ready');

    expect(res.status).toBe(200);
    expect(res.body.info.postgres.status).toBe('up');
  });

  it('liveness stays 200 while a dependency is down', async () => {
    app.get(ReadinessRegistry).register('fake-cache', async () => false);

    await request(app.getHttpServer()).get('/health').expect(200);
  });
});
