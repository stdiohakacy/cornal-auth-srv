import { randomUUIDv7 } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { RequestContext } from './request-context.js';

/** Never trust an unbounded client header: it ends up in logs, audit rows and response headers. */
const SAFE_REQUEST_ID = /^[\w-]{8,64}$/;

/**
 * Plain Express middleware, registered with `app.use()` before `app.init()` so that every
 * later middleware (pino-http included), guard, pipe and handler runs inside the ALS scope.
 * `req.ip` already honours the app's `trust proxy` setting.
 */
export function createRequestContextMiddleware(ctx: RequestContext) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const incoming = req.header('x-request-id');
    const requestId =
      incoming !== undefined && SAFE_REQUEST_ID.test(incoming)
        ? incoming
        : randomUUIDv7();
    res.setHeader('x-request-id', requestId);
    ctx.run(
      {
        requestId,
        ip: req.ip,
        userAgent: req.header('user-agent'),
        actorId: undefined,
      },
      next,
    );
  };
}
