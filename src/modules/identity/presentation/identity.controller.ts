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
  type RegisterRequest,
  RegisterRequestSchema,
  type RegisterResponse,
  type VerifyEmailRequest,
  VerifyEmailRequestSchema,
} from '../../../contracts/identity.schemas.js';
import { unwrap } from '../../../shared/infrastructure/http/unwrap.js';
import { AppThrottlerGuard } from '../../../shared/infrastructure/throttling/app-throttler.guard.js';
import { RATE_LIMITS } from '../../../shared/infrastructure/throttling/rate-limits.js';
import { RegisterUserUseCase } from '../application/register-user.use-case.js';
import { VerifyEmailUseCase } from '../application/verify-email.use-case.js';

@Controller('auth')
@UseGuards(AppThrottlerGuard)
export class IdentityController {
  constructor(
    private readonly registerUser: RegisterUserUseCase,
    private readonly verifyEmail: VerifyEmailUseCase,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle(RATE_LIMITS.register)
  @SkipThrottle({ ipEmail: true })
  async register(
    @Body({ schema: RegisterRequestSchema }) body: RegisterRequest,
  ): Promise<RegisterResponse> {
    return unwrap(await this.registerUser.execute(body));
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle(RATE_LIMITS.verifyEmail)
  async confirmEmail(
    @Body({ schema: VerifyEmailRequestSchema }) body: VerifyEmailRequest,
  ): Promise<void> {
    unwrap(await this.verifyEmail.execute(body));
  }
}
