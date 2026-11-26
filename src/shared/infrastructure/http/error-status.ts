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
