import { randomUUIDv7 } from 'node:crypto';

declare const brand: unique symbol;

/** Nominal typing: `UserId` and `SessionId` are both strings but not interchangeable. */
export type Brand<T, B extends string> = T & { readonly [brand]: B };
export type Id<B extends string> = Brand<string, B>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** UUIDv7: time-ordered, B-tree friendly primary keys. Native since Node 24, no `uuid` package. */
export const newId = <B extends string>(): Id<B> => randomUUIDv7() as Id<B>;

/** Parse untrusted input (route params, token claims) into a branded id. */
export const parseId = <B extends string>(raw: string): Id<B> | undefined =>
  UUID_PATTERN.test(raw) ? (raw as Id<B>) : undefined;
