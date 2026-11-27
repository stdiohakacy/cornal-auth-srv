/** `T` with optional keys that may be absent but never hold `undefined`. */
export type DefinedProps<T> = {
  [K in keyof T]?: Exclude<T[K], undefined>;
};

/**
 * Copies `obj` without its undefined-valued keys. Bridges parsed input (`x?: T | undefined`) to
 * APIs typed with `exactOptionalPropertyTypes` (`x?: T`) without a conditional spread per key.
 */
export function definedProps<T extends object>(obj: T): DefinedProps<T> {
  // only undefined values are dropped, so every remaining value matches its key's type
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined),
  ) as DefinedProps<T>;
}
