import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import {
  type ChangePasswordRequest,
  ChangePasswordRequestSchema,
} from '#src/contracts/identity.schemas.js';
import { unwrap } from '#src/shared/infrastructure/http/unwrap.js';
import { AppThrottlerGuard } from '#src/shared/infrastructure/throttling/app-throttler.guard.js';
import { RATE_LIMITS } from '#src/shared/infrastructure/throttling/rate-limits.js';
import type { AccessClaims } from '#src/modules/session/application/ports.js';
import { AccessTokenGuard } from '#src/modules/session/presentation/access-token.guard.js';
import { CurrentAuth } from '#src/modules/session/presentation/current-auth.decorator.js';
import {
  CommonErrorCode,
  IdentityErrorCode,
} from '#src/contracts/error-codes.js';
import { ApiErrors } from '#src/shared/infrastructure/http/openapi/api-docs.js';
import { ChangePasswordUseCase } from '../application/change-password.use-case.js';
import type { UserId } from '../domain/user.js';

/** Signed-in password change (`api` role). Every session is signed out afterwards (worker). */
@Controller('iam/me/password')
@UseGuards(AppThrottlerGuard, AccessTokenGuard)
export class MePasswordController {
  constructor(private readonly changePassword: ChangePasswordUseCase) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle(RATE_LIMITS.changePassword)
  @SkipThrottle({ email: true, ipEmail: true })
  @ApiErrors(
    IdentityErrorCode.InvalidCredentials,
    IdentityErrorCode.AccountLocked,
    IdentityErrorCode.WeakPassword,
    IdentityErrorCode.PasswordBreached,
    CommonErrorCode.ServiceUnavailable,
  )
  async change(
    @CurrentAuth() auth: AccessClaims,
    @Body({ schema: ChangePasswordRequestSchema }) body: ChangePasswordRequest,
  ): Promise<void> {
    unwrap(
      await this.changePassword.execute({
        ...body,
        userId: auth.sub as UserId,
      }),
    );
  }
}
