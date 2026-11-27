/**
 * Single catalog of machine-readable error codes (`NAMESPACE.UPPER_SNAKE`).
 * Pure TS, no framework imports: shared later with cornal-frontend-srv as `@cornal/contracts`.
 * Each module adds its own `as const` object and widens `ErrorCode` below.
 */
export const CommonErrorCode = {
  ValidationFailed: 'COMMON.VALIDATION_FAILED',
  BadRequest: 'COMMON.BAD_REQUEST',
  Unauthenticated: 'COMMON.UNAUTHENTICATED',
  Forbidden: 'COMMON.FORBIDDEN',
  NotFound: 'COMMON.NOT_FOUND',
  Conflict: 'COMMON.CONFLICT',
  ConcurrencyConflict: 'COMMON.CONCURRENCY_CONFLICT',
  RateLimited: 'COMMON.RATE_LIMITED',
  ServiceUnavailable: 'COMMON.SERVICE_UNAVAILABLE',
  Internal: 'COMMON.INTERNAL',
} as const;
export type CommonErrorCode =
  (typeof CommonErrorCode)[keyof typeof CommonErrorCode];

export const IdentityErrorCode = {
  InvalidEmail: 'IDENTITY.INVALID_EMAIL',
  WeakPassword: 'IDENTITY.WEAK_PASSWORD',
  EmailTaken: 'IDENTITY.EMAIL_TAKEN',
  InvalidCredentials: 'IDENTITY.INVALID_CREDENTIALS',
  AccountLocked: 'IDENTITY.ACCOUNT_LOCKED',
  InvalidToken: 'IDENTITY.INVALID_TOKEN',
  PasswordBreached: 'IDENTITY.PASSWORD_BREACHED',
} as const;
export type IdentityErrorCode =
  (typeof IdentityErrorCode)[keyof typeof IdentityErrorCode];

export const SessionErrorCode = {
  Invalid: 'SESSION.INVALID',
  RefreshConflict: 'SESSION.REFRESH_CONFLICT',
  NotFound: 'SESSION.NOT_FOUND',
} as const;
export type SessionErrorCode =
  (typeof SessionErrorCode)[keyof typeof SessionErrorCode];

export const OrgErrorCode = {
  InvalidSlug: 'ORG.INVALID_SLUG',
  SlugTaken: 'ORG.SLUG_TAKEN',
  NotMember: 'ORG.NOT_MEMBER',
  MfaRequired: 'ORG.MFA_REQUIRED',
  EmailNotVerified: 'ORG.EMAIL_NOT_VERIFIED',
} as const;
export type OrgErrorCode = (typeof OrgErrorCode)[keyof typeof OrgErrorCode];

export const AccessErrorCode = {
  Forbidden: 'ACCESS.FORBIDDEN',
  OrgMismatch: 'ACCESS.ORG_MISMATCH',
} as const;
export type AccessErrorCode =
  (typeof AccessErrorCode)[keyof typeof AccessErrorCode];

export type ErrorCode =
  | CommonErrorCode
  | IdentityErrorCode
  | SessionErrorCode
  | OrgErrorCode
  | AccessErrorCode;
