import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { InvariantViolation } from '#src/shared/domain/domain-error.js';
import type { AccessClaims } from '../application/ports.js';
import type { AuthenticatedRequest } from './access-token.guard.js';

/** Claims of the verified access token. Only valid on routes guarded by AccessTokenGuard. */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AccessClaims => {
    const req = context
      .switchToHttp()
      .getRequest<Partial<AuthenticatedRequest>>();
    if (!req.auth)
      throw new InvariantViolation('CurrentAuth used without AccessTokenGuard');
    return req.auth;
  },
);
