import { CommonErrorCode } from '#src/contracts/error-codes.js';
import { DomainError } from './domain-error.js';

/** Capacity shedding (e.g. password-hash admission). Maps to 503 with Retry-After. */
export class ServiceBusyError extends DomainError<
  typeof CommonErrorCode.ServiceUnavailable
> {
  readonly code = CommonErrorCode.ServiceUnavailable;

  constructor(retryAfterSeconds: number) {
    super('Service is busy, retry shortly', { retryAfterSeconds });
  }
}
