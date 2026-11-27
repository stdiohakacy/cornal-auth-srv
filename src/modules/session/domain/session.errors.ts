import { SessionErrorCode } from '../../../contracts/error-codes.js';
import { DomainError } from '../../../shared/domain/domain-error.js';

/** Unknown, expired, revoked or reused credentials. One message for all: reveal nothing. */
export class SessionInvalidError extends DomainError<
  typeof SessionErrorCode.Invalid
> {
  readonly code = SessionErrorCode.Invalid;
  constructor() {
    super('Session is invalid or expired');
  }
}

/** Another request rotated this refresh token a moment ago (e.g. two tabs). Retry with the newer one. */
export class RefreshConflictError extends DomainError<
  typeof SessionErrorCode.RefreshConflict
> {
  readonly code = SessionErrorCode.RefreshConflict;
  constructor() {
    super('Refresh token was just rotated by another request');
  }
}
