import { InvariantViolation } from './domain-error.js';
import { invariant, lookup, single } from './guard.js';

describe('guard', () => {
  it('single throws InvariantViolation on 0 or 2 items', () => {
    expect(() => single([], 'row')).toThrow(InvariantViolation);
    expect(() => single([1, 2], 'row')).toThrow(
      'Expected exactly one row, got 2',
    );
    expect(single([7], 'row')).toBe(7);
  });

  it('lookup ignores inherited keys', () => {
    expect(lookup({}, 'toString')).toBeUndefined();
    expect(lookup({ a: 1 }, 'a')).toBe(1);
  });

  it('invariant narrows and throws with the message', () => {
    const value: string | undefined = 'x';
    invariant(value, 'value required');
    expect(value.length).toBe(1);
    expect(() => invariant(false, 'value required')).toThrow('value required');
  });
});
