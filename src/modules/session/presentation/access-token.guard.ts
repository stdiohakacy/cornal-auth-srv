import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { RequestContext } from '../../../shared/infrastructure/request-context/request-context.js';
import {
  ACCESS_TOKEN_SERVICE,
  type AccessClaims,
  type AccessTokenService,
} from '../application/ports.js';
import { SessionInvalidError } from '../domain/session.errors.js';

export type AuthenticatedRequest = Request & { auth: AccessClaims };

const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;

/**
 * Verifies `Authorization: Bearer <access token>` locally (ES256, iss, aud, exp, typ) and exposes the
 * claims as `request.auth`. Revoked-session checks arrive with the revocation map (Phase 6).
 */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    @Inject(ACCESS_TOKEN_SERVICE) private readonly tokens: AccessTokenService,
    private readonly ctx: RequestContext,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request & { auth?: AccessClaims }>();
    const match = BEARER.exec(req.header('authorization') ?? '');
    const claims = match?.[1] ? await this.tokens.verify(match[1]) : undefined;
    if (!claims) {
      http
        .getResponse<Response>()
        .setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
      throw new SessionInvalidError();
    }
    req.auth = claims;
    const meta = this.ctx.current();
    if (meta) meta.actorId = claims.sub;
    return true;
  }
}
