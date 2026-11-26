import { AsyncLocalStorage } from 'node:async_hooks';

export type RequestMeta = {
  readonly requestId: string;
  readonly ip: string | undefined;
  readonly userAgent: string | undefined;
  actorId: string | undefined; // set once by the access-token guard
};

export class RequestContext {
  readonly #storage = new AsyncLocalStorage<RequestMeta>();
  run<T>(meta: RequestMeta, fn: () => T): T {
    return this.#storage.run(meta, fn);
  }
  current(): RequestMeta | undefined {
    return this.#storage.getStore();
  }
}
