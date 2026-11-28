import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { OpenAPIObject, OperationObject } from '@nestjs/swagger';
import request from 'supertest';
import type { AppRole } from '../../src/config/env.schema.js';
import { createAppOpenApiDocument } from '../../src/openapi/app-openapi.js';
import { ACCESS_TOKEN_SCHEME } from '../../src/shared/infrastructure/http/openapi/api-docs.js';
import { createTestApp, testConfig } from './support/create-app.js';

const METHODS = ['get', 'post', 'patch', 'put', 'delete'] as const;

const operations = (doc: OpenAPIObject) =>
  Object.entries(doc.paths).flatMap(([path, item]) =>
    METHODS.flatMap((method) => {
      const operation: OperationObject | undefined = item[method];
      return operation ? [{ path, method, operation }] : [];
    }),
  );

const concrete = (path: string): string =>
  path.replaceAll(/\{[^}]+\}/g, () => randomUUID());

describe.each<AppRole>(['login', 'api'])(
  'OpenAPI document (%s role)',
  (role) => {
    let app: NestExpressApplication;
    let doc: OpenAPIObject;

    beforeAll(async () => {
      app = await createTestApp({ APP_ROLE: role });
      doc = createAppOpenApiDocument(app, { ...testConfig(), APP_ROLE: role });
    });

    afterAll(async () => {
      await app.close();
    });

    it('documents a request schema for every route that validates a body', () => {
      const bodies = operations(doc).filter(
        ({ operation }) => operation.requestBody,
      );
      expect(bodies.length).toBeGreaterThan(0);
      for (const { operation } of bodies) {
        expect(JSON.stringify(operation.requestBody)).toContain('"properties"');
      }
    });

    it('declares security exactly where anonymous callers get 401', async () => {
      const mismatches: string[] = [];
      for (const { path, method, operation } of operations(doc)) {
        const res = await request(app.getHttpServer())[method](concrete(path));
        const security = operation.security ?? [];
        const needsToken = security.some((s) => ACCESS_TOKEN_SCHEME in s);
        const label = `${method.toUpperCase()} ${path} -> ${res.status}`;

        if (needsToken && res.status !== 401)
          mismatches.push(`${label}, documented as needing a token`);
        if (res.status === 401 && security.length === 0)
          mismatches.push(`${label}, documented without security`);
      }
      expect(mismatches).toEqual([]);
    });
  },
);

describe('OpenAPI document details', () => {
  let app: NestExpressApplication;
  let doc: OpenAPIObject;

  beforeAll(async () => {
    app = await createTestApp();
    doc = createAppOpenApiDocument(app, testConfig());
  });

  afterAll(async () => {
    await app.close();
  });

  it('marks the refresh body optional (web clients send only the cookie)', () => {
    expect(doc.paths['/auth/refresh']?.post?.requestBody).toMatchObject({
      required: false,
    });
  });

  it('documents login failures as problem+json under their mapped status', () => {
    const responses = doc.paths['/auth/login']?.post?.responses ?? {};

    expect(responses['401']).toMatchObject({
      content: {
        'application/problem+json': {
          examples: { 'IDENTITY.INVALID_CREDENTIALS': expect.any(Object) },
        },
      },
    });
    expect(responses['423']).toBeDefined();
  });
});

describe('Swagger UI', () => {
  let app: NestExpressApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('serves the document when OPENAPI_ENABLED', async () => {
    app = await createTestApp({ OPENAPI_ENABLED: true });

    const res = await request(app.getHttpServer()).get('/docs/openapi.json');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      paths: { '/auth/login': { post: expect.any(Object) } },
    });
    await request(app.getHttpServer())
      .get('/docs')
      .expect(200)
      .expect('content-type', /html/);
  });

  it('is not mounted by default', async () => {
    app = await createTestApp();

    await request(app.getHttpServer()).get('/docs/openapi.json').expect(404);
  });
});
