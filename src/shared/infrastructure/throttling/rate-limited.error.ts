import { CommonErrorCode } from '#src/contracts/error-codes.js';
import { DomainError } from '#src/shared/domain/domain-error.js';

/** 429 with a standard `Retry-After` header (set by AppExceptionFilter from details). */
export class RateLimitedError extends DomainError<
  typeof CommonErrorCode.RateLimited
> {
  readonly code = CommonErrorCode.RateLimited;

  constructor(retryAfterSeconds: number) {
    super('Too many requests, retry later', {
      retryAfterSeconds: Math.max(1, retryAfterSeconds),
    });
  }
}
