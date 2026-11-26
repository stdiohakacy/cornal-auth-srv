import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { parseConfig } from './env.schema.js';

const minimalEnv = {
  DATABASE_URL: 'postgres://u:p@localhost:6432/db',
  DATABASE_DIRECT_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  NATS_URL: 'nats://localhost:4222',
};

describe('parseConfig', () => {
  it('parses a minimal valid env and applies defaults', () => {
    const result = parseConfig(minimalEnv);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.APP_ROLE).toBe('api');
    expect(result.value.PORT).toBe(3001);
    expect(result.value.NODE_ENV).toBe('development');
  });

  it('coerces PORT from string', () => {
    const result = parseConfig({ ...minimalEnv, PORT: '8080' });

    expect(result).toMatchObject({ ok: true, value: { PORT: 8080 } });
  });

  it('rejects an unknown APP_ROLE and lists the allowed values', () => {
    const result = parseConfig({ ...minimalEnv, APP_ROLE: 'admin' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('APP_ROLE');
    expect(result.error).toContain('login');
  });

  it('reports every missing required variable at once', () => {
    const result = parseConfig({});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    for (const name of [
      'DATABASE_URL',
      'DATABASE_DIRECT_URL',
      'REDIS_URL',
      'NATS_URL',
    ]) {
      expect(result.error).toContain(name);
    }
  });

  it('returns a frozen object', () => {
    const result = parseConfig(minimalEnv);

    expect(result.ok && Object.isFrozen(result.value)).toBe(true);
  });

  it('TRUST_PROXY defaults to "loopback"', () => {
    expect(parseConfig(minimalEnv)).toMatchObject({
      ok: true,
      value: { TRUST_PROXY: 'loopback' },
    });
  });

  it('TRUST_PROXY "false" becomes false', () => {
    expect(parseConfig({ ...minimalEnv, TRUST_PROXY: 'false' })).toMatchObject({
      ok: true,
      value: { TRUST_PROXY: false },
    });
  });

  it('TRUST_PROXY "2" becomes 2', () => {
    expect(parseConfig({ ...minimalEnv, TRUST_PROXY: '2' })).toMatchObject({
      ok: true,
      value: { TRUST_PROXY: 2 },
    });
  });

  it('LOG_LEVEL accepts silent', () => {
    expect(parseConfig({ ...minimalEnv, LOG_LEVEL: 'silent' })).toMatchObject({
      ok: true,
      value: { LOG_LEVEL: 'silent' },
    });
  });

  it('.env.example satisfies the schema', () => {
    const example = parseEnv(
      readFileSync(new URL('../../.env.example', import.meta.url), 'utf8'),
    );

    expect(parseConfig(example)).toMatchObject({ ok: true });
  });
});
