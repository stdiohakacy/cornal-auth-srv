/**
 * Tracks additions/removals of a child collection so the repository writes a diff
 * (e.g. role_permissions rows) instead of delete-all + re-insert.
 */
export abstract class WatchedList<T> {
  #current: T[];
  readonly #initial: readonly T[];
  #added: T[] = [];
  #removed: T[] = [];

  protected constructor(initial: readonly T[]) {
    this.#initial = [...initial];
    this.#current = [...initial];
  }

  protected abstract same(a: T, b: T): boolean;

  get items(): readonly T[] {
    return this.#current;
  }
  get added(): readonly T[] {
    return this.#added;
  }
  get removed(): readonly T[] {
    return this.#removed;
  }

  has(item: T): boolean {
    return this.#current.some((x) => this.same(x, item));
  }

  add(item: T): void {
    if (this.has(item)) return;
    this.#removed = this.#removed.filter((x) => !this.same(x, item));
    if (!this.#initial.some((x) => this.same(x, item))) this.#added.push(item);
    this.#current.push(item);
  }

  remove(item: T): void {
    if (!this.has(item)) return;
    this.#current = this.#current.filter((x) => !this.same(x, item));
    const wasNew = this.#added.some((x) => this.same(x, item));
    this.#added = this.#added.filter((x) => !this.same(x, item));
    if (!wasNew) this.#removed.push(item);
  }
}
