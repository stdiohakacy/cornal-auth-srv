import { STATUS_CODES } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import {
  GUARDS_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants.js';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum.js';
import { ModulesContainer, Reflector } from '@nestjs/core';
import {
  DocumentBuilder,
  type OpenAPIObject,
  type OperationObject,
  type ResponseObject,
  type SchemaObject,
  type SecurityRequirementObject,
  type SecuritySchemeObject,
  SwaggerModule,
} from '@nestjs/swagger';
import { z } from 'zod';
import { CommonErrorCode, type ErrorCode } from '#src/contracts/error-codes.js';
import { ProblemDetailsSchema } from '#src/contracts/problem.schemas.js';
import { ERROR_STATUS } from '../error-status.js';
import { API_ERRORS, API_RESULT } from './api-docs.js';

/** What one route handler declares, read from Nest and ApiErrors/ApiResult metadata. */
export type RouteDoc = {
  readonly guards: readonly unknown[];
  readonly errors: readonly ErrorCode[];
  readonly result?: z.ZodType;
  /** The `@Body({ schema })` schema accepts a missing body (e.g. web refresh via cookie). */
  readonly optionalBody?: boolean;
};

/** What putting a guard on a route means for its contract. */
export type GuardDoc = {
  readonly security?: SecurityRequirementObject;
  readonly errors: readonly ErrorCode[];
};

export type OpenApiOptions = {
  readonly title: string;
  readonly description: string;
  readonly securitySchemes: Readonly<Record<string, SecuritySchemeObject>>;
  readonly guards: ReadonlyMap<unknown, GuardDoc>;
};

const PROBLEM_REF = '#/components/schemas/ProblemDetails';
const HTTP_METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'patch',
  'options',
  'head',
  'trace',
] as const;

const operationKey = (controller: string, method: string): string =>
  `${controller}_${method}`;

/**
 * The OpenAPI document of the routes mounted in `app`. Bodies and params come from the
 * `@Body({ schema })` / `@Param(..., { schema })` Zod schemas; security and error responses are
 * derived from each route's guards and ApiErrors, so the document cannot drift from them.
 */
export function createOpenApiDocument(
  app: INestApplication,
  options: OpenApiOptions,
): OpenAPIObject {
  let builder = new DocumentBuilder()
    .setTitle(options.title)
    .setDescription(options.description);
  for (const [name, scheme] of Object.entries(options.securitySchemes)) {
    builder = builder.addSecurity(name, scheme);
  }
  const document = SwaggerModule.createDocument(app, builder.build(), {
    operationIdFactory: operationKey,
  });
  return annotateOperations(document, collectRouteDocs(app), options.guards);
}

/** Every route handler of every mounted controller, keyed like the operation ids above. */
function collectRouteDocs(app: INestApplication): Map<string, RouteDoc> {
  const reflector = new Reflector();
  const routes = new Map<string, RouteDoc>();
  for (const module of app.get(ModulesContainer).values()) {
    for (const { metatype } of module.controllers.values()) {
      if (typeof metatype !== 'function') continue;
      const prototype: unknown = metatype.prototype;
      if (typeof prototype !== 'object' || prototype === null) continue;
      for (const name of Object.getOwnPropertyNames(prototype)) {
        const handler: unknown = Reflect.get(prototype, name);
        if (typeof handler !== 'function') continue;
        if (!Reflect.hasMetadata(PATH_METADATA, handler)) continue;
        const targets = [handler, metatype];
        const result = reflector.get<z.ZodType | undefined>(
          API_RESULT,
          handler,
        );
        routes.set(operationKey(metatype.name, name), {
          guards: reflector.getAllAndMerge<unknown[]>(GUARDS_METADATA, targets),
          errors: reflector.getAllAndMerge<ErrorCode[]>(API_ERRORS, targets),
          ...(result ? { result } : {}),
          optionalBody: acceptsNoBody(metatype, name),
        });
      }
    }
  }
  return routes;
}

function acceptsNoBody(controller: object, method: string): boolean {
  const args: unknown = Reflect.getMetadata(
    ROUTE_ARGS_METADATA,
    controller,
    method,
  );
  if (typeof args !== 'object' || args === null) return false;
  return Object.entries(args).some(
    ([key, arg]: [string, unknown]) =>
      key.startsWith(`${RouteParamtypes.BODY}:`) &&
      typeof arg === 'object' &&
      arg !== null &&
      'schema' in arg &&
      arg.schema instanceof z.ZodType &&
      arg.schema.safeParse(undefined).success,
  );
}

/** Pure: adds security, problem responses and result schemas to each operation. */
export function annotateOperations(
  document: OpenAPIObject,
  routes: ReadonlyMap<string, RouteDoc>,
  guards: ReadonlyMap<unknown, GuardDoc>,
): OpenAPIObject {
  const annotated = structuredClone(document);
  for (const [path, item] of Object.entries(annotated.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = item[method];
      if (operation === undefined) continue;
      const route = routes.get(operation.operationId ?? '');
      if (route === undefined) {
        throw new Error(
          `No route handler for operation ${method.toUpperCase()} ${path}`,
        );
      }
      annotate(operation, route, guards, path);
    }
  }
  annotated.components = {
    ...annotated.components,
    schemas: {
      ...annotated.components?.schemas,
      ProblemDetails: toOpenApiSchema(ProblemDetailsSchema),
    },
  };
  return annotated;
}

function annotate(
  operation: OperationObject,
  route: RouteDoc,
  guards: ReadonlyMap<unknown, GuardDoc>,
  path: string,
): void {
  const guardDocs = route.guards.flatMap((guard) => {
    const doc = guards.get(guard);
    return doc ? [doc] : [];
  });

  const security = guardDocs.flatMap((doc) =>
    doc.security ? [doc.security] : [],
  );
  // Every guard runs, so all their schemes are required together: one requirement object.
  if (security.length > 0)
    operation.security = [Object.assign({}, ...security)];

  if (
    route.optionalBody &&
    operation.requestBody &&
    !('$ref' in operation.requestBody)
  ) {
    operation.requestBody.required = false;
  }

  const codes = new Set<ErrorCode>([
    ...guardDocs.flatMap((doc) => doc.errors),
    ...route.errors,
  ]);
  if (operation.requestBody || (operation.parameters?.length ?? 0) > 0) {
    codes.add(CommonErrorCode.ValidationFailed);
  }
  codes.add(CommonErrorCode.Internal);

  const byStatus = new Map<number, ErrorCode[]>();
  for (const code of codes) {
    const status = ERROR_STATUS[code];
    byStatus.set(status, [...(byStatus.get(status) ?? []), code]);
  }
  for (const [status, group] of byStatus) {
    operation.responses[String(status)] = problemResponse(status, group, path);
  }

  if (route.result) {
    const success = Object.keys(operation.responses).find((status) =>
      /^2\d\d$/.test(status),
    );
    if (success === undefined) {
      throw new Error(`Operation ${operation.operationId} has no 2xx response`);
    }
    operation.responses[success] = {
      description: '',
      content: {
        'application/json': { schema: toOpenApiSchema(route.result) },
      },
    };
  }
}

function problemResponse(
  status: number,
  codes: readonly ErrorCode[],
  path: string,
): ResponseObject {
  const title = STATUS_CODES[status] ?? 'Error';
  return {
    description: codes.join(' | '),
    content: {
      'application/problem+json': {
        schema: { $ref: PROBLEM_REF },
        examples: Object.fromEntries(
          codes.map((code) => [
            code,
            {
              value: {
                type: 'about:blank',
                title,
                status,
                code,
                detail: title,
                instance: path,
                requestId: '0198c0de-0000-7000-8000-000000000000',
              },
            },
          ]),
        ),
      },
    },
  };
}

function toOpenApiSchema(schema: z.ZodType): SchemaObject {
  const { $schema: _dialect, ...json } = z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    io: 'output',
  });
  // Zod emits an OpenAPI 3.0 schema object for this target.
  return json as SchemaObject;
}
