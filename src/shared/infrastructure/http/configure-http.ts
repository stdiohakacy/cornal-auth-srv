import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import type { AppConfig } from '#src/config/env.schema.js';
import { RequestContext } from '../request-context/request-context.js';
import { createRequestContextMiddleware } from '../request-context/request-context.middleware.js';
import { AppExceptionFilter } from './app-exception.filter.js';
import { FailClosedValidationPipe } from './request-validation.js';

/**
 * The single place that wires the HTTP pipeline. Called by `main.ts` and by the e2e helper,
 * so tests always run the production setup. Must run before `app.init()`.
 */
export function configureHttp(
  app: NestExpressApplication,
  config: AppConfig,
): void {
  const ctx = app.get(RequestContext);
  app.useLogger(app.get(Logger));
  // Security headers (also removes x-powered-by). CSP is for HTML documents: off for a JSON API.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      frameguard: { action: 'deny' },
    }),
  );
  app.set('trust proxy', config.TRUST_PROXY);
  app.use(createRequestContextMiddleware(ctx));
  app.useGlobalPipes(new FailClosedValidationPipe());
  app.useGlobalFilters(new AppExceptionFilter(ctx));
}
