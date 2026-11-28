import { execFileSync } from 'node:child_process';
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

  it('OUTBOX_RELAY_ENABLED "false" becomes false', () => {
    expect(
      parseConfig({ ...minimalEnv, OUTBOX_RELAY_ENABLED: 'false' }),
    ).toMatchObject({ ok: true, value: { OUTBOX_RELAY_ENABLED: false } });
  });

  it('OPENAPI_ENABLED is off unless set to "true"', () => {
    expect(parseConfig(minimalEnv)).toMatchObject({
      ok: true,
      value: { OPENAPI_ENABLED: false },
    });
    expect(
      parseConfig({ ...minimalEnv, OPENAPI_ENABLED: 'true' }),
    ).toMatchObject({ ok: true, value: { OPENAPI_ENABLED: true } });
  });

  it('DB_POOL_MAX defaults to 5', () => {
    expect(parseConfig(minimalEnv)).toMatchObject({
      ok: true,
      value: { DB_POOL_MAX: 5, OUTBOX_RELAY_ENABLED: true },
    });
  });

  it('EMAIL_VERIFICATION_URL has a local default and accepts a URL', () => {
    expect(parseConfig(minimalEnv)).toMatchObject({
      ok: true,
      value: {
        EMAIL_VERIFICATION_URL: 'http://localhost:3000/verify-email',
        EMAIL_TRANSPORT: 'log',
      },
    });
  });

  it('PASSWORD_PEPPER must be at least 32 characters when set', () => {
    expect(parseConfig({ ...minimalEnv, PASSWORD_PEPPER: 'short' }).ok).toBe(
      false,
    );
    expect(
      parseConfig({ ...minimalEnv, PASSWORD_PEPPER: 'p'.repeat(32) }).ok,
    ).toBe(true);
  });

  it('refuses the log email transport in production (it would log secret links)', () => {
    const result = parseConfig({
      ...minimalEnv,
      NODE_ENV: 'production',
      EMAIL_TRANSPORT: 'log',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('EMAIL_TRANSPORT');
  });

  it('APP_LOGIN_URL defaults locally; UV_THREADPOOL_SIZE is optional and bounded', () => {
    expect(parseConfig(minimalEnv)).toMatchObject({
      ok: true,
      value: { APP_LOGIN_URL: 'http://localhost:3000/login' },
    });
    expect(
      parseConfig({ ...minimalEnv, UV_THREADPOOL_SIZE: '16' }),
    ).toMatchObject({
      ok: true,
      value: { UV_THREADPOOL_SIZE: 16 },
    });
    expect(parseConfig({ ...minimalEnv, UV_THREADPOOL_SIZE: '0' }).ok).toBe(
      false,
    );
  });

  it('EMAIL_TRANSPORT smtp requires SMTP_URL', () => {
    expect(
      parseConfig({ ...minimalEnv, EMAIL_TRANSPORT: 'smtp' }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining('SMTP_URL'),
    });

    expect(
      parseConfig({
        ...minimalEnv,
        EMAIL_TRANSPORT: 'smtp',
        SMTP_URL: 'smtp://localhost:1025',
      }).ok,
    ).toBe(true);
  });

  it('EMAIL_FROM has a default', () => {
    expect(parseConfig(minimalEnv)).toMatchObject({
      ok: true,
      value: { EMAIL_FROM: 'Cornal <no-reply@cornal.local>' },
    });
  });

  it('PASSWORD_RESET_URL defaults locally; PASSWORD_BREACH_CHECK "false" becomes false', () => {
    expect(
      parseConfig({ ...minimalEnv, PASSWORD_BREACH_CHECK: 'false' }),
    ).toMatchObject({
      ok: true,
      value: {
        PASSWORD_RESET_URL: 'http://localhost:3000/reset-password',
        PASSWORD_BREACH_CHECK: false,
      },
    });
  });

  it('JWT_SIGNING_KEYS parses a JSON key list', () => {
    const keys = [
      {
        kid: 'k1',
        pem: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
      },
    ];

    expect(
      parseConfig({ ...minimalEnv, JWT_SIGNING_KEYS: JSON.stringify(keys) }),
    ).toMatchObject({
      ok: true,
      value: { JWT_SIGNING_KEYS: keys },
    });
  });

  it('rejects malformed JWT_SIGNING_KEYS', () => {
    for (const bad of ['not json', '[]', '[{"kid":"k1","pem":"nope"}]']) {
      expect(
        parseConfig({ ...minimalEnv, JWT_SIGNING_KEYS: bad }),
      ).toMatchObject({
        ok: false,
        error: expect.stringContaining('JWT_SIGNING_KEYS'),
      });
    }
  });

  it('requires JWT_SIGNING_KEYS in production', () => {
    expect(
      parseConfig({
        ...minimalEnv,
        NODE_ENV: 'production',
        EMAIL_TRANSPORT: 'smtp',
        SMTP_URL: 'smtp://mail.example.com:587',
      }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining('JWT_SIGNING_KEYS'),
    });
  });

  it('token TTL defaults', () => {
    expect(parseConfig(minimalEnv)).toMatchObject({
      ok: true,
      value: {
        JWT_ISSUER: 'http://localhost:3001',
        JWT_AUDIENCE: 'cornal-platform',
        ACCESS_TOKEN_TTL_SECONDS: 600,
        REFRESH_IDLE_TTL_SECONDS: 1_209_600,
        REFRESH_ABSOLUTE_TTL_SECONDS: 2_592_000,
      },
    });
  });

  it('absolute TTL must not be shorter than idle', () => {
    expect(
      parseConfig({
        ...minimalEnv,
        REFRESH_IDLE_TTL_SECONDS: '7200',
        REFRESH_ABSOLUTE_TTL_SECONDS: '3600',
      }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining('REFRESH_ABSOLUTE_TTL_SECONDS'),
    });
  });

  it('keys:generate output is a valid JWT_SIGNING_KEYS value', () => {
    const line = execFileSync(
      process.execPath,
      ['scripts/generate-signing-key.mjs'],
      {
        encoding: 'utf8',
      },
    ).trim();
    const value = line.replace(/^JWT_SIGNING_KEYS=/, '');

    expect(
      parseConfig({ ...minimalEnv, JWT_SIGNING_KEYS: value }),
    ).toMatchObject({ ok: true });
  });

  it('.env.example satisfies the schema', () => {
    const example = parseEnv(
      readFileSync(new URL('../../.env.example', import.meta.url), 'utf8'),
    );

    expect(parseConfig(example)).toMatchObject({ ok: true });
  });
});
