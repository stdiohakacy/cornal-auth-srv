import { err, ok, type Result } from '../../../shared/domain/result.js';
import { ValueObject } from '../../../shared/domain/value-object.js';
import { InvalidSlugError } from './organization.errors.js';

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/;

/** URL-safe organization handle, unique across the platform. */
export class Slug extends ValueObject<{ value: string }> {
  private constructor(value: string) {
    super({ value });
  }

  static create(raw: string): Result<Slug, InvalidSlugError> {
    const value = raw.trim().toLowerCase();
    return SLUG_PATTERN.test(value)
      ? ok(new Slug(value))
      : err(new InvalidSlugError());
  }

  static fromPersistence(value: string): Slug {
    return new Slug(value);
  }

  get value(): string {
    return this.props.value;
  }
}
