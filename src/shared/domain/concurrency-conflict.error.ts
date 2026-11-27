import { CommonErrorCode } from '#src/contracts/error-codes.js';
import { DomainError } from './domain-error.js';

/**
 * Optimistic-lock failure: the aggregate changed since it was loaded. Thrown by repositories
 * (it is not a business outcome), rolled back by the UoW, mapped to 409 by AppExceptionFilter.
 */
export class ConcurrencyConflictError extends DomainError<
  typeof CommonErrorCode.ConcurrencyConflict
> {
  readonly code = CommonErrorCode.ConcurrencyConflict;

  constructor(aggregateType: string, aggregateId: string) {
    super(`${aggregateType} was modified by another request; retry`, {
      aggregateType,
      aggregateId,
    });
  }
}
