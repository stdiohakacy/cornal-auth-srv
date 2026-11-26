import { ValueObject } from './value-object.js';

class Money extends ValueObject<{ amount: number; currency: string }> {
  constructor(amount: number, currency: string) {
    super({ amount, currency });
  }
  get raw() {
    return this.props;
  }
}

class Price extends ValueObject<{ amount: number; currency: string }> {
  constructor(amount: number, currency: string) {
    super({ amount, currency });
  }
}

describe('ValueObject', () => {
  it('equal props → equals true', () => {
    expect(new Money(1, 'VND').equals(new Money(1, 'VND'))).toBe(true);
    expect(new Money(1, 'VND').equals(new Money(2, 'VND'))).toBe(false);
  });

  it('different subclass with same props → false', () => {
    expect(new Money(1, 'VND').equals(new Price(1, 'VND'))).toBe(false);
  });

  it('props are frozen', () => {
    expect(Object.isFrozen(new Money(1, 'VND').raw)).toBe(true);
  });
});
