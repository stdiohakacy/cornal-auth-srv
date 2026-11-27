import { ValueObject } from '#src/shared/domain/value-object.js';
import { err, ok, type Result } from '#src/shared/domain/result.js';
import { InvalidEmailError } from './identity.errors.js';

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_LENGTH = 254;

export class Email extends ValueObject<{ value: string }> {
  private constructor(value: string) {
    super({ value });
  }

  /** Untrusted input: normalizes and validates. */
  static create(raw: string): Result<Email, InvalidEmailError> {
    const value = raw.trim().toLowerCase();
    if (
      value.length === 0 ||
      value.length > MAX_LENGTH ||
      !EMAIL_PATTERN.test(value)
    ) {
      return err(new InvalidEmailError());
    }
    return ok(new Email(value));
  }

  /** Trusted input from the database: no re-validation cost, no Result unwrapping. */
  static fromPersistence(value: string): Email {
    return new Email(value);
  }

  get value(): string {
    return this.props.value;
  }
}
