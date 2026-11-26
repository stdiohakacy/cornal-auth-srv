/**
 * Expected business failure. Carries a stable machine-readable `code`, never an HTTP status.
 * Returned inside `Result` by domain/application code; mapped to HTTP only in presentation.
 */
export abstract class DomainError<C extends string = string> extends Error {
  abstract readonly code: C;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    message: string,
    details?: Readonly<Record<string, unknown>>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
    this.details = details;
  }
}

/** Programmer error / broken invariant. Thrown, never returned. Becomes HTTP 500. */
export class InvariantViolation extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'InvariantViolation';
  }
}
