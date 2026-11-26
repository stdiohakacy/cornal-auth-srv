import { Email } from './email.js';

describe('Email', () => {
  it('normalizes case and whitespace', () => {
    const result = Email.create('  Alice@Example.COM ');
    expect(result.ok && result.value.value).toBe('alice@example.com');
  });

  it('rejects missing @ and >254 chars', () => {
    expect(Email.create('no-at-sign').ok).toBe(false);
    expect(Email.create(`${'a'.repeat(250)}@x.co`).ok).toBe(false);
  });
});
