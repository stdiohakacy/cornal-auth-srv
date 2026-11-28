import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { ApiCookieAuth } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  type LoginRequest,
  LoginRequestSchema,
  type RefreshRequest,
  RefreshRequestSchema,
  type SessionInfoResponse,
  SessionInfoResponseSchema,
  type TokenResponse,
  TokenResponseSchema,
} from '#src/contracts/session.schemas.js';
import {
  type SwitchOrganizationRequest,
  SwitchOrganizationRequestSchema,
} from '#src/contracts/organization.schemas.js';
import type { DomainError } from '#src/shared/domain/domain-error.js';
import { unwrap } from '#src/shared/infrastructure/http/unwrap.js';
import { AppThrottlerGuard } from '#src/shared/infrastructure/throttling/app-throttler.guard.js';
import { RATE_LIMITS } from '#src/shared/infrastructure/throttling/rate-limits.js';
import {
  CommonErrorCode,
  IdentityErrorCode,
  OrgErrorCode,
  SessionErrorCode,
} from '#src/contracts/error-codes.js';
import {
  ApiErrors,
  ApiResult,
  REFRESH_COOKIE_SCHEME,
} from '#src/shared/infrastructure/http/openapi/api-docs.js';
import type { IssuedTokens } from '../application/issued-tokens.js';
import { LoginUseCase } from '../application/login.use-case.js';
import { LogoutUseCase } from '../application/logout.use-case.js';
import type { AccessClaims } from '../application/ports.js';
import { RefreshSessionUseCase } from '../application/refresh-session.use-case.js';
import { SwitchOrganizationUseCase } from '../application/switch-organization.use-case.js';
import type { SessionId } from '../domain/session.js';
import { SessionInvalidError } from '../domain/session.errors.js';
import { AccessTokenGuard } from './access-token.guard.js';
import { CurrentAuth } from './current-auth.decorator.js';
import {
  READ_REFRESH_COOKIE_OPTIONS,
  readRefreshCookie,
  REFRESH_COOKIE_NAME,
  refreshCookieOptions,
} from './refresh-cookie.js';

const isMobile = (req: Request): boolean =>
  req.header('x-client-type') === 'mobile';

/** Web clients get the refresh token as an HttpOnly cookie; mobile clients in the JSON body. */
@Controller('auth')
@UseGuards(AppThrottlerGuard)
export class SessionController {
  constructor(
    private readonly loginUseCase: LoginUseCase<DomainError>,
    private readonly refreshUseCase: RefreshSessionUseCase,
    private readonly logoutUseCase: LogoutUseCase,
    private readonly switchUseCase: SwitchOrganizationUseCase,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle(RATE_LIMITS.login)
  @ApiResult(TokenResponseSchema)
  @ApiErrors(
    IdentityErrorCode.InvalidCredentials,
    IdentityErrorCode.AccountLocked,
    CommonErrorCode.ServiceUnavailable,
  )
  async login(
    @Body({ schema: LoginRequestSchema }) body: LoginRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TokenResponse> {
    const result = await this.loginUseCase.execute({
      ...body,
      ...clientOf(req),
    });
    return respond(req, res, unwrap(result));
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle(RATE_LIMITS.refresh)
  @SkipThrottle({ email: true, ipEmail: true })
  @ApiCookieAuth(REFRESH_COOKIE_SCHEME)
  @ApiResult(TokenResponseSchema)
  @ApiErrors(SessionErrorCode.Invalid, SessionErrorCode.RefreshConflict)
  async refresh(
    @Body({ schema: RefreshRequestSchema }) body: RefreshRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TokenResponse> {
    const refreshToken =
      body?.refreshToken ?? readRefreshCookie(req.headers.cookie);
    if (refreshToken === undefined) throw new SessionInvalidError();
    return respond(
      req,
      res,
      unwrap(
        await this.refreshUseCase.execute({ refreshToken, ...clientOf(req) }),
      ),
    );
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle(RATE_LIMITS.refresh)
  @SkipThrottle({ email: true, ipEmail: true })
  @ApiCookieAuth(REFRESH_COOKIE_SCHEME)
  async logout(
    @Body({ schema: RefreshRequestSchema }) body: RefreshRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const refreshToken =
      body?.refreshToken ?? readRefreshCookie(req.headers.cookie);
    if (refreshToken !== undefined)
      unwrap(await this.logoutUseCase.execute({ refreshToken }));
    res.clearCookie(REFRESH_COOKIE_NAME, READ_REFRESH_COOKIE_OPTIONS);
  }

  /** Re-scopes this session to another organization: new access token, same refresh family. */
  @Post('session/organization')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AccessTokenGuard)
  @Throttle(RATE_LIMITS.refresh)
  @SkipThrottle({ email: true, ipEmail: true })
  @ApiResult(TokenResponseSchema)
  @ApiErrors(OrgErrorCode.NotMember, OrgErrorCode.MfaRequired)
  async switchOrganization(
    @CurrentAuth() auth: AccessClaims,
    @Body({ schema: SwitchOrganizationRequestSchema })
    body: SwitchOrganizationRequest,
  ): Promise<TokenResponse> {
    const switched = unwrap(
      await this.switchUseCase.execute({
        sessionId: auth.sid as SessionId, // verified token claim
        userId: auth.sub,
        orgId: body.orgId,
        tokenVersion: auth.uv,
      }),
    );
    return {
      accessToken: switched.accessToken,
      tokenType: 'Bearer',
      expiresIn: switched.expiresIn,
    };
  }

  @Get('session')
  @UseGuards(AccessTokenGuard)
  @SkipThrottle({ email: true, ipEmail: true })
  @ApiResult(SessionInfoResponseSchema)
  session(@CurrentAuth() auth: AccessClaims): SessionInfoResponse {
    return {
      userId: auth.sub,
      sessionId: auth.sid,
      authTime: auth.authTime.toISOString(),
      amr: [...auth.amr],
    };
  }
}

const clientOf = (req: Request) => ({
  ip: req.ip ?? null,
  userAgent: req.header('user-agent') ?? null,
});

function respond(
  req: Request,
  res: Response,
  tokens: IssuedTokens,
): TokenResponse {
  const body: TokenResponse = {
    accessToken: tokens.accessToken,
    tokenType: 'Bearer',
    expiresIn: tokens.expiresIn,
  };
  if (isMobile(req)) return { ...body, refreshToken: tokens.refreshToken };
  res.cookie(
    REFRESH_COOKIE_NAME,
    tokens.refreshToken,
    refreshCookieOptions(tokens.refreshMaxAgeSeconds),
  );
  return body;
}
