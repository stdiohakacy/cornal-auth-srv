import { InvariantViolation } from './domain-error.js';

/** Narrowing assertion; replaces `value!` that oxlint flags (no-non-null-assertion). */
export function invariant(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new InvariantViolation(message);
}

/** Exhaustiveness check for discriminated unions in `switch`. */
export function assertNever(value: never): never {
  throw new InvariantViolation(`Unhandled variant: ${JSON.stringify(value)}`);
}

/** Index-safe accessors under `noUncheckedIndexedAccess`. */
export const first = <T>(items: readonly T[]): T | undefined => items[0];
export const last = <T>(items: readonly T[]): T | undefined => items.at(-1);

/** Exactly one element or an invariant violation (e.g. `INSERT ... RETURNING`). */
export function single<T>(items: readonly T[], what: string): T {
  const [item, ...rest] = items;
  if (item === undefined || rest.length > 0) {
    throw new InvariantViolation(
      `Expected exactly one ${what}, got ${items.length}`,
    );
  }
  return item;
}

/** Safe record lookup: returns `undefined` instead of pretending the key exists. */
export const lookup = <V>(
  record: Readonly<Partial<Record<string, V>>>,
  key: string,
): V | undefined => (Object.hasOwn(record, key) ? record[key] : undefined);
