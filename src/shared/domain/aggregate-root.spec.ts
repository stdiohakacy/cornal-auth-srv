import { AggregateRoot } from './aggregate-root.js';
import { createEvent, type DomainEvent } from './domain-event.js';

type CounterEvent = DomainEvent<'test.counter.incremented', { by: number }>;

class Counter extends AggregateRoot<string, { value: number }, CounterEvent> {
  constructor() {
    super('c1', { value: 0 });
  }
  increment(by: number): void {
    this.props.value += by;
    this.raise(
      createEvent({
        type: 'test.counter.incremented',
        aggregateType: 'Counter',
        aggregateId: this.id,
        payload: { by },
      }),
    );
  }
}

describe('AggregateRoot', () => {
  it('pullEvents returns raised events once then empty', () => {
    const counter = new Counter();
    counter.increment(2);

    expect(counter.pullEvents().map((e) => e.payload.by)).toEqual([2]);
    expect(counter.pullEvents()).toEqual([]);
  });

  it('markPersisted increments version', () => {
    const counter = new Counter();
    counter.markPersisted();
    expect(counter.version).toBe(1);
  });
});
