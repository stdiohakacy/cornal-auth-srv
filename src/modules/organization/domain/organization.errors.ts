import { OrgErrorCode } from '../../../contracts/error-codes.js';
import { DomainError } from '../../../shared/domain/domain-error.js';

export class InvalidSlugError extends DomainError<
  typeof OrgErrorCode.InvalidSlug
> {
  readonly code = OrgErrorCode.InvalidSlug;
  constructor() {
    super(
      'Slug must be 3-48 lowercase letters, digits or dashes, not starting or ending with a dash',
    );
  }
}

export class SlugTakenError extends DomainError<typeof OrgErrorCode.SlugTaken> {
  readonly code = OrgErrorCode.SlugTaken;
  constructor() {
    super('This organization slug is already taken');
  }
}

export class EmailNotVerifiedError extends DomainError<
  typeof OrgErrorCode.EmailNotVerified
> {
  readonly code = OrgErrorCode.EmailNotVerified;
  constructor() {
    super('Verify your email address before creating an organization');
  }
}
