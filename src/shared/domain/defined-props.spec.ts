import { definedProps } from './defined-props.js';

describe('definedProps', () => {
  it('drops keys whose value is undefined and keeps every other value', () => {
    const input: { a?: number | undefined; b?: string | undefined; c: null } = {
      a: 0,
      b: undefined,
      c: null,
    };

    const result = definedProps(input);

    expect(result).toEqual({ a: 0, c: null });
    expect('b' in result).toBe(false);
  });

  it('types the result as exact optional properties', () => {
    const result: { a?: number } = definedProps({
      a: undefined as number | undefined,
    });
    expect(result).toEqual({});
  });
});
