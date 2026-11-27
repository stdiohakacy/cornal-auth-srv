import type { InjectionToken } from '@nestjs/common';

/** A value taken from an injected provider (e.g. one field of APP_CONFIG). */
type Selected = {
  readonly kind: 'selected';
  readonly token: InjectionToken;
  readonly select: (value: unknown) => unknown;
};
/** A value known when the module is declared; nothing is injected for it. */
type Fixed = { readonly kind: 'fixed'; readonly value: unknown };

export type Dependency = InjectionToken | Selected | Fixed;

export function from<V>(
  token: InjectionToken,
  select: (value: V) => unknown,
): Selected {
  // the provider behind `token` is a V by the module's own wiring
  return {
    kind: 'selected',
    token,
    select: select as (value: unknown) => unknown,
  };
}

export function fixed(value: unknown): Fixed {
  return { kind: 'fixed', value };
}

const isFixed = (dep: Dependency): dep is Fixed =>
  typeof dep === 'object' && 'kind' in dep && dep.kind === 'fixed';
const isSelected = (dep: Dependency): dep is Selected =>
  typeof dep === 'object' && 'kind' in dep && dep.kind === 'selected';

export type ClassProvider<T> = {
  readonly provide: InjectionToken;
  readonly inject: InjectionToken[];
  readonly useFactory: (...resolved: unknown[]) => T;
};

/**
 * A factory provider for a framework-free class (use case or adapter): one dependency per
 * constructor parameter, in order. The tuple type makes a missing or extra dependency a compile
 * error, so modules list tokens once instead of repeating them as typed factory parameters.
 */
export function provideClass<A extends readonly unknown[], T>(
  cls: new (...args: A) => T,
  deps: NoInfer<{ readonly [K in keyof A]: Dependency }>,
  provide: InjectionToken = cls,
): ClassProvider<T> {
  const list: readonly Dependency[] = deps;
  return {
    provide,
    inject: list.flatMap((dep) =>
      isFixed(dep) ? [] : [isSelected(dep) ? dep.token : dep],
    ),
    useFactory: (...resolved) => {
      const queue = [...resolved];
      const args = list.map((dep) => {
        if (isFixed(dep)) return dep.value;
        const value = queue.shift();
        return isSelected(dep) ? dep.select(value) : value;
      });
      // arity and order are enforced by the `deps` tuple type above
      return new cls(...(args as unknown as A));
    },
  };
}
