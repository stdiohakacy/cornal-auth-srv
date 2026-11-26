import type { DomainEvent } from './domain-event.js';
import { Entity } from './entity.js';

/** What the Unit of Work needs from an aggregate, without knowing its type. */
export type EventSource = { pullEvents(): readonly DomainEvent[] };

export abstract class AggregateRoot<
  TId extends string,
  TProps extends object,
  TEvent extends DomainEvent = DomainEvent,
>
  extends Entity<TId, TProps>
  implements EventSource
{
  #events: TEvent[] = [];
  #version: number;

  /** `version` backs optimistic locking (`UPDATE ... WHERE version = $n`). 0 = never persisted. */
  protected constructor(id: TId, props: TProps, version = 0) {
    super(id, props);
    this.#version = version;
  }

  get version(): number {
    return this.#version;
  }

  /** Read-only view for unit tests; does not clear. */
  get pendingEvents(): readonly TEvent[] {
    return this.#events;
  }

  protected raise(event: TEvent): void {
    this.#events.push(event);
  }

  /** Take-and-clear: the UoW calls this exactly once per commit. */
  pullEvents(): readonly TEvent[] {
    const events = this.#events;
    this.#events = [];
    return events;
  }

  /** Called by the repository after a successful conditional UPDATE/INSERT. */
  markPersisted(): void {
    this.#version += 1;
  }
}
