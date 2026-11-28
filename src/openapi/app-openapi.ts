import type { INestApplication } from '@nestjs/common';
import { type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import type { AppConfig } from '../config/env.schema.js';
import {
  AccessErrorCode,
  CommonErrorCode,
  SessionErrorCode,
} from '../contracts/error-codes.js';
import { PermissionsGuard } from '../modules/access-control/presentation/permissions.guard.js';
import { AccessTokenGuard } from '../modules/session/presentation/access-token.guard.js';
import { REFRESH_COOKIE_NAME } from '../modules/session/presentation/refresh-cookie.js';
import {
  ACCESS_TOKEN_SCHEME,
  REFRESH_COOKIE_SCHEME,
} from '../shared/infrastructure/http/openapi/api-docs.js';
import {
  createOpenApiDocument,
  type GuardDoc,
} from '../shared/infrastructure/http/openapi/openapi-document.js';
import { AppThrottlerGuard } from '../shared/infrastructure/throttling/app-throttler.guard.js';

export const OPENAPI_PATH = 'docs';

/** What each guard adds to a route's contract. A new guard gets a line here. */
const GUARDS = new Map<unknown, GuardDoc>([
  [
    AccessTokenGuard,
    {
      security: { [ACCESS_TOKEN_SCHEME]: [] },
      errors: [SessionErrorCode.Invalid],
    },
  ],
  [
    PermissionsGuard,
    { errors: [AccessErrorCode.Forbidden, AccessErrorCode.OrgMismatch] },
  ],
  [AppThrottlerGuard, { errors: [CommonErrorCode.RateLimited] }],
]);

/** The contract of the routes this role serves (each role mounts different controllers). */
export function createAppOpenApiDocument(
  app: INestApplication,
  config: AppConfig,
): OpenAPIObject {
  return createOpenApiDocument(app, {
    title: 'cornal-auth-srv',
    description: `Routes served by the \`${config.APP_ROLE}\` role. Errors are RFC 9457 problem+json; branch on \`code\`.`,
    securitySchemes: {
      [ACCESS_TOKEN_SCHEME]: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
      [REFRESH_COOKIE_SCHEME]: {
        type: 'apiKey',
        in: 'cookie',
        name: REFRESH_COOKIE_NAME,
      },
    },
    guards: GUARDS,
  });
}

/** Serves Swagger UI at /docs and the JSON at /docs/openapi.json when OPENAPI_ENABLED. */
export function setupOpenApi(app: INestApplication, config: AppConfig): void {
  if (!config.OPENAPI_ENABLED) return;
  SwaggerModule.setup(
    OPENAPI_PATH,
    app,
    () => createAppOpenApiDocument(app, config),
    {
      jsonDocumentUrl: `${OPENAPI_PATH}/openapi.json`,
      raw: ['json'],
      customSiteTitle: 'cornal-auth-srv API',
      swaggerOptions: { persistAuthorization: true, filter: true },
    },
  );
}
