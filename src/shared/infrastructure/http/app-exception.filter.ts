import { STATUS_CODES } from 'node:http';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  CommonErrorCode,
  type ErrorCode,
} from '../../../contracts/error-codes.js';
import { DomainError } from '../../domain/domain-error.js';
import type { RequestContext } from '../request-context/request-context.js';
import { ERROR_STATUS, httpStatusToCode, isErrorCode } from './error-status.js';
import {
  type FieldError,
  RequestValidationError,
} from './request-validation.js';

type Problem = {
  readonly status: number;
  readonly code: ErrorCode;
  readonly detail: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly errors?: readonly FieldError[];
};

const INTERNAL: Problem = {
  status: HttpStatus.INTERNAL_SERVER_ERROR,
  code: CommonErrorCode.Internal,
  detail: 'Internal server error',
};

/**
 * The only exception filter. Every error leaves as RFC 9457 `application/problem+json` with a
 * stable `code` and the `requestId`. 5xx bodies never carry the original message.
 */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  readonly #logger = new Logger(AppExceptionFilter.name);

  constructor(private readonly ctx: RequestContext) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    // Only HTTP is wired today; other transports keep their own error semantics.
    if (host.getType() !== 'http') throw exception;

    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const problem = this.toProblem(exception);

    if (problem.status >= 500) {
      this.#logger.error(
        exception instanceof Error ? exception.message : String(exception),
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    const requestId =
      this.ctx.current()?.requestId ?? res.getHeader('x-request-id');
    const retryAfter = problem.details?.['retryAfterSeconds'];
    if (typeof retryAfter === 'number')
      res.setHeader('Retry-After', String(retryAfter));
    res
      .status(problem.status)
      .type('application/problem+json')
      .json({
        type: 'about:blank',
        title: STATUS_CODES[problem.status] ?? 'Error',
        status: problem.status,
        code: problem.code,
        detail: problem.detail,
        instance: req.originalUrl,
        requestId,
        ...(problem.details ? { details: problem.details } : {}),
        ...(problem.errors ? { errors: problem.errors } : {}),
      });
  }

  private toProblem(exception: unknown): Problem {
    if (exception instanceof RequestValidationError) {
      return {
        status: ERROR_STATUS[CommonErrorCode.ValidationFailed],
        code: CommonErrorCode.ValidationFailed,
        detail: exception.message,
        errors: exception.errors,
      };
    }
    if (exception instanceof DomainError) {
      if (!isErrorCode(exception.code)) return INTERNAL;
      const status = ERROR_STATUS[exception.code];
      // 503 is an honest capacity signal (with Retry-After); other 5xx never leak details.
      if (status >= 500 && status !== HttpStatus.SERVICE_UNAVAILABLE)
        return INTERNAL;
      return {
        status,
        code: exception.code,
        detail: exception.message,
        ...(exception.details ? { details: exception.details } : {}),
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status >= 500)
        return { ...INTERNAL, status, code: httpStatusToCode(status) };
      return {
        status,
        code: httpStatusToCode(status),
        detail: exception.message,
      };
    }
    return INTERNAL;
  }
}
