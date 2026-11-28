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
  type AcceptedResponse,
  AcceptedResponseSchema,
  type ForgotPasswordRequest,
  ForgotPasswordRequestSchema,
  type RegisterRequest,
  RegisterRequestSchema,
  type RegisterResponse,
  RegisterResponseSchema,
  type ResetPasswordRequest,
  ResetPasswordRequestSchema,
  type VerifyEmailRequest,
  VerifyEmailRequestSchema,
} from '#src/contracts/identity.schemas.js';
import { unwrap } from '#src/shared/infrastructure/http/unwrap.js';
import { AppThrottlerGuard } from '#src/shared/infrastructure/throttling/app-throttler.guard.js';
import { RATE_LIMITS } from '#src/shared/infrastructure/throttling/rate-limits.js';
import {
  CommonErrorCode,
  IdentityErrorCode,
} from '#src/contracts/error-codes.js';
import {
  ApiErrors,
  ApiResult,
} from '#src/shared/infrastructure/http/openapi/api-docs.js';
import { RegisterUserUseCase } from '../application/register-user.use-case.js';
import { RequestPasswordResetUseCase } from '../application/request-password-reset.use-case.js';
import { ResetPasswordUseCase } from '../application/reset-password.use-case.js';
import { VerifyEmailUseCase } from '../application/verify-email.use-case.js';

@Controller('auth')
@UseGuards(AppThrottlerGuard)
export class IdentityController {
  constructor(
    private readonly registerUser: RegisterUserUseCase,
    private readonly verifyEmail: VerifyEmailUseCase,
    private readonly requestPasswordReset: RequestPasswordResetUseCase,
    private readonly resetPasswordUseCase: ResetPasswordUseCase,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle(RATE_LIMITS.register)
  @SkipThrottle({ ipEmail: true })
  @ApiResult(RegisterResponseSchema)
  @ApiErrors(
    IdentityErrorCode.InvalidEmail,
    IdentityErrorCode.WeakPassword,
    IdentityErrorCode.PasswordBreached,
    CommonErrorCode.ServiceUnavailable,
  )
  async register(
    @Body({ schema: RegisterRequestSchema }) body: RegisterRequest,
  ): Promise<RegisterResponse> {
    return unwrap(await this.registerUser.execute(body));
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle(RATE_LIMITS.verifyEmail)
  @ApiErrors(IdentityErrorCode.InvalidToken)
  async confirmEmail(
    @Body({ schema: VerifyEmailRequestSchema }) body: VerifyEmailRequest,
  ): Promise<void> {
    unwrap(await this.verifyEmail.execute(body));
  }

  /** Same 202 for known and unknown emails; the link is emailed by the worker. */
  @Post('password/forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle(RATE_LIMITS.forgotPassword)
  @SkipThrottle({ ipEmail: true })
  @ApiResult(AcceptedResponseSchema)
  async forgotPassword(
    @Body({ schema: ForgotPasswordRequestSchema }) body: ForgotPasswordRequest,
  ): Promise<AcceptedResponse> {
    return unwrap(await this.requestPasswordReset.execute(body));
  }

  @Post('password/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle(RATE_LIMITS.resetPassword)
  @ApiErrors(
    IdentityErrorCode.InvalidToken,
    IdentityErrorCode.WeakPassword,
    IdentityErrorCode.PasswordBreached,
    CommonErrorCode.ServiceUnavailable,
  )
  async resetPassword(
    @Body({ schema: ResetPasswordRequestSchema }) body: ResetPasswordRequest,
  ): Promise<void> {
    unwrap(await this.resetPasswordUseCase.execute(body));
  }
}
