import { AccessErrorCode } from '../../../contracts/error-codes.js';
import { DomainError } from '../../../shared/domain/domain-error.js';

/** No org in the token, or a required permission bit is not set. */
export class AccessForbiddenError extends DomainError<
  typeof AccessErrorCode.Forbidden
> {
  readonly code = AccessErrorCode.Forbidden;
  constructor() {
    super('You do not have permission to perform this action');
  }
}

/** The token is scoped to another organization than the route's :orgId. */
export class OrgMismatchError extends DomainError<
  typeof AccessErrorCode.OrgMismatch
> {
  readonly code = AccessErrorCode.OrgMismatch;
  constructor() {
    super('The access token is scoped to a different organization');
  }
}
