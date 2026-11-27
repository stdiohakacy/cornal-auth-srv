import type { DomainError } from '#src/shared/domain/domain-error.js';
import type { Result } from '#src/shared/domain/result.js';

/** Controller-side bridge: ok → value, err → throw for AppExceptionFilter to map. */
export function unwrap<T>(result: Result<T, DomainError>): T {
  if (result.ok) return result.value;
  throw result.error;
}
