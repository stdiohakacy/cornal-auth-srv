import { fixed, from, provideClass } from './provide-class.js';

const A = Symbol('A');
const CONFIG = Symbol('CONFIG');

class Target {
  constructor(
    readonly a: string,
    readonly url: string,
    readonly limit: number,
  ) {}
}

describe('provideClass', () => {
  const provider = provideClass(Target, [
    A,
    from(CONFIG, (config: { url: string }) => config.url),
    fixed(5),
  ]);

  it('provides the class itself as the token', () => {
    expect(provider.provide).toBe(Target);
  });

  it('injects every token dependency in order, skipping fixed values', () => {
    expect(provider.inject).toEqual([A, CONFIG]);
  });

  it('constructs the class from resolved, selected and fixed values', () => {
    const built = provider.useFactory('a-value', { url: 'https://x' });
    expect(built).toEqual(new Target('a-value', 'https://x', 5));
  });

  it('accepts an explicit provide token', () => {
    const TOKEN = Symbol('TOKEN');
    expect(provideClass(Target, [A, A, fixed(1)], TOKEN).provide).toBe(TOKEN);
  });

  it('rejects a dependency list that does not match the constructor', () => {
    // @ts-expect-error three constructor parameters, two dependencies
    expect(provideClass(Target, [A, A]).inject).toHaveLength(2);
  });
});
