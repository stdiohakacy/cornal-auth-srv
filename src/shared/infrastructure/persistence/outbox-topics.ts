/**
 * Domain event types that leave the process through the outbox. Modules register the topics their
 * consumers handle (in every role, since producers and consumers run in different processes).
 *
 * Why not publish everything: messages are keyed by aggregate id, and a message nobody handles is
 * retried — which holds back every later message of the same aggregate until it dead-letters
 * (hours). Unregistered events stay in-process domain events.
 */
export class OutboxTopics {
  readonly #topics = new Set<string>();

  register(...topics: readonly string[]): void {
    for (const topic of topics) this.#topics.add(topic);
  }

  isPublished(topic: string): boolean {
    return this.#topics.has(topic);
  }
}
