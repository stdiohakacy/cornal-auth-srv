import {
  type ArgumentMetadata,
  StandardSchemaValidationPipe,
  type StandardSchemaValidationPipeOptions,
} from '@nestjs/common';
import { InvariantViolation } from '../../domain/domain-error.js';

type SchemaIssue = Parameters<
  NonNullable<StandardSchemaValidationPipeOptions['exceptionFactory']>
>[0][number];

export type FieldError = { readonly path: string; readonly message: string };

/** Thrown by the pipe; AppExceptionFilter turns it into 422 COMMON.VALIDATION_FAILED. */
export class RequestValidationError extends Error {
  readonly errors: readonly FieldError[];

  constructor(issues: readonly SchemaIssue[]) {
    super('Request validation failed');
    this.name = 'RequestValidationError';
    this.errors = issues.map((issue) => ({
      path: (issue.path ?? [])
        .map((segment) =>
          String(typeof segment === 'object' ? segment.key : segment),
        )
        .join('.'),
      message: issue.message,
    }));
  }
}

const MUST_HAVE_SCHEMA: ReadonlySet<ArgumentMetadata['type']> = new Set([
  'body',
  'query',
  'param',
]);

/**
 * Fails closed: a `@Body()`, `@Query()` or `@Param()` without `{ schema }` is a programming
 * error and never reaches the handler (500), instead of silently accepting unvalidated input.
 */
export class FailClosedValidationPipe extends StandardSchemaValidationPipe {
  constructor() {
    super({ exceptionFactory: (issues) => new RequestValidationError(issues) });
  }

  override async transform<T>(
    value: T,
    metadata: ArgumentMetadata,
  ): Promise<T> {
    if (MUST_HAVE_SCHEMA.has(metadata.type) && metadata.schema === undefined) {
      throw new InvariantViolation(
        `Missing schema for ${metadata.type} parameter`,
      );
    }
    return super.transform(value, metadata);
  }
}
