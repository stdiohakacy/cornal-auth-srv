import { assertLocalTestServer } from './support/test-db.js';

describe('assertLocalTestServer', () => {
  it('accepts local hosts', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]', 'postgres']) {
      expect(() =>
        assertLocalTestServer(`postgres://u:p@${host}:5432/x`, false),
      ).not.toThrow();
    }
  });

  it('refuses a remote host because global setup drops databases', () => {
    expect(() =>
      assertLocalTestServer('postgres://u:p@db.prod.example.com:5432/x', false),
    ).toThrow(/refusing to drop databases on db\.prod\.example\.com/);
  });

  it('allows a remote host only with the explicit opt-in', () => {
    expect(() =>
      assertLocalTestServer('postgres://u:p@ci-db.internal:5432/x', true),
    ).not.toThrow();
  });
});
