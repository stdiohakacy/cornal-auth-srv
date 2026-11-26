import { combine, err, map, ok } from './result.js';

describe('Result', () => {
  it('combine returns all values in order', () => {
    expect(combine([ok(1), ok(2), ok(3)])).toEqual(ok([1, 2, 3]));
  });

  it('combine returns the first error', () => {
    expect(combine([ok(1), err('a'), err('b')])).toEqual(err('a'));
  });

  it('map leaves an err untouched', () => {
    const failure = err('boom');
    expect(map(failure, (n: number) => n + 1)).toBe(failure);
  });
});
