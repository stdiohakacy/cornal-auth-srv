/**
 * Identity-based equality. `props` is `protected` (not `#private`) so subclasses can expose
 * getters and mutate state only through intention-revealing methods.
 */
export abstract class Entity<TId extends string, TProps extends object> {
  readonly id: TId;
  protected props: TProps;

  protected constructor(id: TId, props: TProps) {
    this.id = id;
    this.props = props;
  }

  equals(other: Entity<TId, TProps> | undefined): boolean {
    return (
      other !== undefined &&
      other.constructor === this.constructor &&
      other.id === this.id
    );
  }
}
