import { IdentityErrorCode } from '../../../contracts/error-codes.js';
import { DomainError } from '../../../shared/domain/domain-error.js';

export class InvalidEmailError extends DomainError<
  typeof IdentityErrorCode.InvalidEmail
> {
  readonly code = IdentityErrorCode.InvalidEmail;
  constructor() {
    super('Email address is invalid');
  }
}

export class WeakPasswordError extends DomainError<
  typeof IdentityErrorCode.WeakPassword
> {
  readonly code = IdentityErrorCode.WeakPassword;
  constructor(reason: string) {
    super('Password does not meet the policy', { reason });
  }
}

export class EmailTakenError extends DomainError<
  typeof IdentityErrorCode.EmailTaken
> {
  readonly code = IdentityErrorCode.EmailTaken;
  constructor() {
    super('Email address is already registered');
  }
}

/** Same error for "unknown email" and "wrong password": no account enumeration. */
export class InvalidCredentialsError extends DomainError<
  typeof IdentityErrorCode.InvalidCredentials
> {
  readonly code = IdentityErrorCode.InvalidCredentials;
  constructor() {
    super('Invalid email or password');
  }
}

export class AccountLockedError extends DomainError<
  typeof IdentityErrorCode.AccountLocked
> {
  readonly code = IdentityErrorCode.AccountLocked;
  constructor(lockedUntil: Date) {
    super('Account is temporarily locked', {
      lockedUntil: lockedUntil.toISOString(),
    });
  }
}

export class InvalidTokenError extends DomainError<
  typeof IdentityErrorCode.InvalidToken
> {
  readonly code = IdentityErrorCode.InvalidToken;
  constructor() {
    super('Token is invalid or expired');
  }
}

/** The password appears in known breach corpora (HIBP): refuse it, whatever its length. */
export class PasswordBreachedError extends DomainError<
  typeof IdentityErrorCode.PasswordBreached
> {
  readonly code = IdentityErrorCode.PasswordBreached;
  constructor() {
    super('This password has appeared in a data breach; choose another one');
  }
}
