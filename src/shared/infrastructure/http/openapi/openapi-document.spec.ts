import type { OpenAPIObject, OperationObject } from '@nestjs/swagger';
import { z } from 'zod';
import { annotateOperations, type RouteDoc } from './openapi-document.js';

class TokenGuard {}
class ThrottleGuard {}

const GUARDS = new Map([
  [
    TokenGuard,
    { security: { accessToken: [] }, errors: ['SESSION.INVALID'] as const },
  ],
  [ThrottleGuard, { errors: ['COMMON.RATE_LIMITED'] as const }],
]);

const docWith = (operation: OperationObject): OpenAPIObject => ({
  openapi: '3.0.0',
  info: { title: 't', version: '1' },
  paths: {
    '/things': { post: { operationId: 'Things_create', ...operation } },
  },
});

const route = (overrides: Partial<RouteDoc> = {}): Map<string, RouteDoc> =>
  new Map([['Things_create', { guards: [], errors: [], ...overrides }]]);

const annotated = (
  operation: OperationObject,
  overrides: Partial<RouteDoc> = {},
): OperationObject => {
  const op = annotateOperations(docWith(operation), route(overrides), GUARDS)
    .paths['/things']?.post;
  if (op === undefined) throw new Error('operation missing');
  return op;
};

const problemExamples = (op: OperationObject, status: string): string[] => {
  const response = op.responses[status];
  if (response === undefined || '$ref' in response) return [];
  return Object.keys(
    response.content?.['application/problem+json']?.examples ?? {},
  );
};

describe('annotateOperations', () => {
  const plain: OperationObject = { responses: { '201': { description: '' } } };

  it('derives security and 401 from the guards on the route', () => {
    const op = annotated(plain, { guards: [ThrottleGuard, TokenGuard] });

    expect(op.security).toEqual([{ accessToken: [] }]);
    expect(problemExamples(op, '401')).toEqual(['SESSION.INVALID']);
    expect(problemExamples(op, '429')).toEqual(['COMMON.RATE_LIMITED']);
  });

  it('leaves security alone when no guard declares one', () => {
    const op = annotated(
      { ...plain, security: [{ refreshCookie: [] }] },
      { guards: [ThrottleGuard] },
    );

    expect(op.security).toEqual([{ refreshCookie: [] }]);
  });

  it('groups declared codes under the status ERROR_STATUS maps them to', () => {
    const op = annotated(plain, {
      errors: ['ORG.SLUG_TAKEN', 'ORG.LAST_OWNER', 'ORG.INVALID_SLUG'],
    });

    expect(problemExamples(op, '409')).toEqual([
      'ORG.SLUG_TAKEN',
      'ORG.LAST_OWNER',
    ]);
    expect(problemExamples(op, '422')).toContain('ORG.INVALID_SLUG');
  });

  it('documents 422 only for operations that take input', () => {
    const withBody = annotated({ ...plain, requestBody: { content: {} } });

    expect(problemExamples(withBody, '422')).toEqual([
      'COMMON.VALIDATION_FAILED',
    ]);
    expect(annotated(plain).responses['422']).toBeUndefined();
  });

  it('marks the request body optional when its schema accepts no body', () => {
    const op = annotated(
      { ...plain, requestBody: { required: true, content: {} } },
      { optionalBody: true },
    );

    expect(op.requestBody).toMatchObject({ required: false });
  });

  it('documents 500 on every operation', () => {
    expect(problemExamples(annotated(plain), '500')).toEqual([
      'COMMON.INTERNAL',
    ]);
  });

  it('puts the result schema on the existing success status', () => {
    const op = annotated(
      { responses: { '202': { description: '' } } },
      { result: z.strictObject({ id: z.string() }) },
    );

    expect(op.responses['202']).toMatchObject({
      content: {
        'application/json': {
          schema: { type: 'object', properties: { id: { type: 'string' } } },
        },
      },
    });
  });

  it('registers the ProblemDetails schema the error responses point to', () => {
    const doc = annotateOperations(docWith(plain), route(), GUARDS);

    expect(doc.components?.schemas?.['ProblemDetails']).toMatchObject({
      type: 'object',
      required: expect.arrayContaining(['status', 'code', 'requestId']),
    });
  });

  it('fails loudly when an operation has no known handler', () => {
    expect(() => annotateOperations(docWith(plain), new Map(), GUARDS)).toThrow(
      /POST \/things/,
    );
  });
});
