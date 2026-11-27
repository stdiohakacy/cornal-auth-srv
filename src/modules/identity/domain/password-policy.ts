import { err, ok, type Result } from '#src/shared/domain/result.js';
import { IDENTITY_POLICY } from './identity-policy.js';
import { WeakPasswordError } from './identity.errors.js';

const { minLength: MIN_LENGTH, maxLength: MAX_LENGTH } =
  IDENTITY_POLICY.password;

/** Length-based policy (NIST SP 800-63B). Breached-password screening is added in Phase 3b. */
export function checkPasswordPolicy(
  plain: string,
): Result<void, WeakPasswordError> {
  if (plain.trim().length === 0) return err(new WeakPasswordError('blank'));
  if (plain.length < MIN_LENGTH)
    return err(new WeakPasswordError(`min length ${MIN_LENGTH}`));
  if (plain.length > MAX_LENGTH)
    return err(new WeakPasswordError(`max length ${MAX_LENGTH}`));
  return ok(undefined);
}
