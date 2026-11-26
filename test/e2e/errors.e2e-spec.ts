import { Body, Controller, Get, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { z } from 'zod';
import { CommonErrorCode } from '../../src/contracts/error-codes.js';
import { DomainError } from '../../src/shared/domain/domain-error.js';
import { createTestApp } from './support/create-app.js';

class TestConflictError extends DomainError<typeof CommonErrorCode.Conflict> {
  readonly code = CommonErrorCode.Conflict;
}

class UncatalogedError extends DomainError<'TEST.NOT_IN_CATALOG'> {
  readonly code = 'TEST.NOT_IN_CATALOG' as const;
}

const SignupSchema = z.strictObject({ email: z.email() });

const executed = { unschemed: false };

@Controller('__errors')
class ErrorProbeController {
  @Get('unknown')
  unknown(): never {
    throw new Error('db password=hunter2');
  }

  @Get('domain')
  domain(): never {
    throw new TestConflictError('Email already registered', { field: 'email' });
  }

  @Get('uncataloged')
  uncataloged(): never {
    throw new UncatalogedError('should not leak');
  }

  @Post('validated')
  validated(
    @Body({ schema: SignupSchema }) body: z.infer<typeof SignupSchema>,
  ) {
    return body;
  }

  @Post('unschemed')
  unschemed(@Body() body: unknown) {
    executed.unschemed = true;
    return body;
  }
}

describe('error responses (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp({}, { controllers: [ErrorProbeController] });
  });

  afterAll(async () => {
    await app.close();
  });

  it('unknown error → 500 problem+json with requestId and no original message', async () => {
    const res = await request(app.getHttpServer()).get('/__errors/unknown');

    expect(res.status).toBe(500);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.body).toMatchObject({
      type: 'about:blank',
      status: 500,
      code: 'COMMON.INTERNAL',
      detail: 'Internal server error',
      instance: '/__errors/unknown',
    });
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });

  it('DomainError → mapped status and code', async () => {
    const res = await request(app.getHttpServer()).get('/__errors/domain');

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'COMMON.CONFLICT',
      detail: 'Email already registered',
      details: { field: 'email' },
    });
  });

  it('DomainError with a code outside the catalog → 500 without its message', async () => {
    const res = await request(app.getHttpServer()).get('/__errors/uncataloged');

    expect(res.status).toBe(500);
    expect(res.body.code).toBe('COMMON.INTERNAL');
    expect(JSON.stringify(res.body)).not.toContain('should not leak');
  });

  it('invalid body → 422 with field errors', async () => {
    const res = await request(app.getHttpServer())
      .post('/__errors/validated')
      .send({ email: 'x' });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('COMMON.VALIDATION_FAILED');
    expect(res.body.errors[0].path).toBe('email');
  });

  it('valid body passes through the schema', async () => {
    await request(app.getHttpServer())
      .post('/__errors/validated')
      .send({ email: 'a@b.co' })
      .expect(201, { email: 'a@b.co' });
  });

  it('route without schema → 500 and handler not executed', async () => {
    const res = await request(app.getHttpServer())
      .post('/__errors/unschemed')
      .send({ anything: true });

    expect(res.status).toBe(500);
    expect(res.body.code).toBe('COMMON.INTERNAL');
    expect(executed.unschemed).toBe(false);
  });

  it('does not advertise the framework (no x-powered-by)', async () => {
    const res = await request(app.getHttpServer()).get('/health');

    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('sets standard security headers on every response', async () => {
    const res = await request(app.getHttpServer()).get('/health');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toMatch(/max-age=\d+/);
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
  });

  it('does not send a browser CSP on a JSON API', async () => {
    const res = await request(app.getHttpServer()).get('/health');

    expect(res.headers['content-security-policy']).toBeUndefined();
  });

  it('unknown route → 404 COMMON.NOT_FOUND', async () => {
    const res = await request(app.getHttpServer()).get('/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.body.code).toBe('COMMON.NOT_FOUND');
  });
});
