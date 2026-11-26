import { randomUUIDv7 } from 'node:crypto';

/**
 * Plain, JSON-serializable data. No class hierarchy, no `constructor.name` routing,
 * no request-context lookup. Correlation/actor metadata is attached by infrastructure
 * when the event is written to the outbox.
 */
export type DomainEvent<
  TType extends string = string,
  TPayload extends object = object,
> = {
  readonly id: string;
  readonly type: TType;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly occurredAt: string;
  readonly schemaVersion: number;
  readonly payload: Readonly<TPayload>;
};

export function createEvent<
  TType extends string,
  TPayload extends object,
>(input: {
  readonly type: TType;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: TPayload;
  readonly occurredAt?: Date;
  readonly schemaVersion?: number;
}): DomainEvent<TType, TPayload> {
  return Object.freeze({
    id: randomUUIDv7(),
    type: input.type,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    occurredAt: (input.occurredAt ?? new Date()).toISOString(),
    schemaVersion: input.schemaVersion ?? 1,
    payload: Object.freeze({ ...input.payload }),
  });
}
