type Primitive = string | number | boolean | bigint | null;

/**
 * Flat, immutable value object. Props are primitives only: compose VOs instead of nesting
 * objects, so equality stays a cheap structural compare (no JSON.stringify, no key-order bugs).
 */
export abstract class ValueObject<
  TProps extends Readonly<Record<string, Primitive>>,
> {
  protected readonly props: Readonly<TProps>;

  protected constructor(props: TProps) {
    this.props = Object.freeze({ ...props });
  }

  equals(other: ValueObject<TProps> | undefined): boolean {
    if (other === undefined || other.constructor !== this.constructor)
      return false;
    const keys = Object.keys(this.props);
    if (keys.length !== Object.keys(other.props).length) return false;
    return keys.every((key) => Object.is(this.props[key], other.props[key]));
  }
}
