import { QueryFailedError } from 'typeorm';

const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

type PgDriverError = { readonly code?: unknown; readonly constraint?: unknown };

function isPgError(error: unknown, code: string, constraint?: string): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const driverError: PgDriverError = error.driverError;
  if (driverError.code !== code) return false;
  return constraint === undefined || driverError.constraint === constraint;
}

/** True for a PostgreSQL unique violation, optionally on one named constraint. */
export const isUniqueViolation = (
  error: unknown,
  constraint?: string,
): boolean => isPgError(error, UNIQUE_VIOLATION, constraint);

/** True for a PostgreSQL foreign-key violation, optionally on one named constraint. */
export const isForeignKeyViolation = (
  error: unknown,
  constraint?: string,
): boolean => isPgError(error, FOREIGN_KEY_VIOLATION, constraint);
