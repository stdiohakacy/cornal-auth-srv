import { Controller, Get } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { RequestContext } from '../../src/shared/infrastructure/request-context/request-context.js';
import { createTestApp } from './support/create-app.js';

@Controller('__ctx')
class ContextProbeController {
  constructor(private readonly ctx: RequestContext) {}

  @Get()
  read() {
    return this.ctx.current() ?? null;
  }
}

const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('request context (e2e)', () => {
  let app: NestExpressApplication;

  afterEach(async () => {
    await app.close();
  });

  it('generates a UUIDv7 request id and echoes it in the header', async () => {
    app = await createTestApp({}, { controllers: [ContextProbeController] });

    const res = await request(app.getHttpServer()).get('/__ctx').expect(200);

    expect(res.body.requestId).toMatch(UUID_V7);
    expect(res.headers['x-request-id']).toBe(res.body.requestId);
  });

  it('keeps a valid incoming x-request-id', async () => {
    app = await createTestApp({}, { controllers: [ContextProbeController] });

    const res = await request(app.getHttpServer())
      .get('/__ctx')
      .set('x-request-id', 'gateway-abc-123')
      .expect(200);

    expect(res.body.requestId).toBe('gateway-abc-123');
    expect(res.headers['x-request-id']).toBe('gateway-abc-123');
  });

  it('replaces an invalid incoming x-request-id', async () => {
    app = await createTestApp({}, { controllers: [ContextProbeController] });

    for (const bad of ['bad id!', 'a'.repeat(65), 'short']) {
      const res = await request(app.getHttpServer())
        .get('/__ctx')
        .set('x-request-id', bad)
        .expect(200);
      expect(res.body.requestId).toMatch(UUID_V7);
    }
  });

  it('TRUST_PROXY loopback uses X-Forwarded-For', async () => {
    app = await createTestApp(
      { TRUST_PROXY: 'loopback' },
      { controllers: [ContextProbeController] },
    );

    const res = await request(app.getHttpServer())
      .get('/__ctx')
      .set('x-forwarded-for', '203.0.113.7')
      .expect(200);

    expect(res.body.ip).toBe('203.0.113.7');
  });

  it('TRUST_PROXY false ignores X-Forwarded-For', async () => {
    app = await createTestApp(
      { TRUST_PROXY: false },
      { controllers: [ContextProbeController] },
    );

    const res = await request(app.getHttpServer())
      .get('/__ctx')
      .set('x-forwarded-for', '203.0.113.7')
      .expect(200);

    expect(res.body.ip).not.toBe('203.0.113.7');
    expect(typeof res.body.ip).toBe('string');
  });
});
