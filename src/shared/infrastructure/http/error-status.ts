import { HttpStatus } from '@nestjs/common';
import {
  CommonErrorCode,
  type ErrorCode,
} from '../../../contracts/error-codes.js';

/** Adding a code to the catalog without a status here is a compile error. */
export const ERROR_STATUS = {
  'COMMON.VALIDATION_FAILED': HttpStatus.UNPROCESSABLE_ENTITY,
  'COMMON.BAD_REQUEST': HttpStatus.BAD_REQUEST,
  'COMMON.UNAUTHENTICATED': HttpStatus.UNAUTHORIZED,
  'COMMON.FORBIDDEN': HttpStatus.FORBIDDEN,
  'COMMON.NOT_FOUND': HttpStatus.NOT_FOUND,
  'COMMON.CONFLICT': HttpStatus.CONFLICT,
  'COMMON.CONCURRENCY_CONFLICT': HttpStatus.CONFLICT,
  'COMMON.RATE_LIMITED': HttpStatus.TOO_MANY_REQUESTS,
  'COMMON.SERVICE_UNAVAILABLE': HttpStatus.SERVICE_UNAVAILABLE,
  'COMMON.INTERNAL': HttpStatus.INTERNAL_SERVER_ERROR,
  'IDENTITY.INVALID_EMAIL': HttpStatus.UNPROCESSABLE_ENTITY,
  'IDENTITY.WEAK_PASSWORD': HttpStatus.UNPROCESSABLE_ENTITY,
  'IDENTITY.EMAIL_TAKEN': HttpStatus.CONFLICT,
  'IDENTITY.INVALID_CREDENTIALS': HttpStatus.UNAUTHORIZED,
  'IDENTITY.ACCOUNT_LOCKED': HttpStatus.LOCKED,
  'IDENTITY.INVALID_TOKEN': HttpStatus.BAD_REQUEST,
  'IDENTITY.PASSWORD_BREACHED': HttpStatus.UNPROCESSABLE_ENTITY,
  'SESSION.INVALID': HttpStatus.UNAUTHORIZED,
  'SESSION.REFRESH_CONFLICT': HttpStatus.CONFLICT,
  'SESSION.NOT_FOUND': HttpStatus.NOT_FOUND,
  'ORG.INVALID_SLUG': HttpStatus.UNPROCESSABLE_ENTITY,
  'ORG.SLUG_TAKEN': HttpStatus.CONFLICT,
  'ORG.NOT_MEMBER': HttpStatus.FORBIDDEN,
  'ORG.MFA_REQUIRED': HttpStatus.FORBIDDEN,
  'ORG.EMAIL_NOT_VERIFIED': HttpStatus.FORBIDDEN,
  'ACCESS.FORBIDDEN': HttpStatus.FORBIDDEN,
  'ACCESS.ORG_MISMATCH': HttpStatus.FORBIDDEN,
} as const satisfies Record<ErrorCode, HttpStatus>;

export const isErrorCode = (code: string): code is ErrorCode =>
  Object.hasOwn(ERROR_STATUS, code);

const CODE_BY_STATUS: Readonly<Partial<Record<number, ErrorCode>>> = {
  [HttpStatus.BAD_REQUEST]: CommonErrorCode.BadRequest,
  [HttpStatus.UNAUTHORIZED]: CommonErrorCode.Unauthenticated,
  [HttpStatus.FORBIDDEN]: CommonErrorCode.Forbidden,
  [HttpStatus.NOT_FOUND]: CommonErrorCode.NotFound,
  [HttpStatus.CONFLICT]: CommonErrorCode.Conflict,
  [HttpStatus.UNPROCESSABLE_ENTITY]: CommonErrorCode.ValidationFailed,
  [HttpStatus.TOO_MANY_REQUESTS]: CommonErrorCode.RateLimited,
  [HttpStatus.SERVICE_UNAVAILABLE]: CommonErrorCode.ServiceUnavailable,
};

/** For framework `HttpException`s that carry a status but no domain code. */
export function httpStatusToCode(status: number): ErrorCode {
  return (
    CODE_BY_STATUS[status] ??
    (status < 500 ? CommonErrorCode.BadRequest : CommonErrorCode.Internal)
  );
}
