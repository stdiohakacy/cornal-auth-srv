import { QueryFailedError } from 'typeorm';

const UNIQUE_VIOLATION = '23505';

type PgDriverError = { readonly code?: unknown; readonly constraint?: unknown };

/** True for a PostgreSQL unique violation, optionally on one named constraint. */
export function isUniqueViolation(
  error: unknown,
  constraint?: string,
): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const driverError: PgDriverError = error.driverError;
  if (driverError.code !== UNIQUE_VIOLATION) return false;
  return constraint === undefined || driverError.constraint === constraint;
}
