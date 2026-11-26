import { type ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';
import { RateLimitedError } from './rate-limited.error.js';

/** Same counting as ThrottlerGuard; rejects with RateLimitedError → 429 problem+json + Retry-After. */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected override async throwThrottlingException(
    _context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    throw new RateLimitedError(detail.timeToBlockExpire || detail.timeToExpire);
  }
}
