import { Writable } from 'node:stream';
import { pino } from 'pino';
import { testConfigFor } from './logger.options.test-support.js';
import {
  buildPinoHttpOptions,
  pinoBaseOptions,
  redactUrl,
} from './logger.options.js';
import { RequestContext } from '../request-context/request-context.js';

function capture(level: 'info' | 'warn' = 'info') {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  const logger = pino(pinoBaseOptions(testConfigFor(level)), stream);
  return { logger, lines };
}

describe('pino options', () => {
  it('redacts authorization and cookie headers', () => {
    const { logger, lines } = capture();

    logger.info(
      {
        req: {
          headers: { authorization: 'Bearer secret', cookie: 'rt=secret' },
        },
      },
      'hit',
    );

    const entry = JSON.parse(lines[0] ?? '{}');
    expect(entry.req.headers).toEqual({
      authorization: '[Redacted]',
      cookie: '[Redacted]',
    });
  });

  it('redacts nested password and refreshToken', () => {
    const { logger, lines } = capture();

    logger.info(
      { body: { email: 'a@b.co', password: 'hunter2', refreshToken: 'rt' } },
      'login',
    );

    const raw = lines[0] ?? '';
    expect(raw).not.toContain('hunter2');
    expect(JSON.parse(raw).body).toEqual({
      email: 'a@b.co',
      password: '[Redacted]',
      refreshToken: '[Redacted]',
    });
  });

  it('keeps harmless code fields such as err.code', () => {
    const { logger, lines } = capture();

    logger.error({ err: { code: 'ECONNREFUSED' } }, 'db down');

    expect(JSON.parse(lines[0] ?? '{}').err.code).toBe('ECONNREFUSED');
  });

  it('redacts one-time codes in query and body', () => {
    const { logger, lines } = capture();

    logger.info(
      {
        req: { query: { code: 'oauth-secret', state: 's1' } },
        body: { otp: '123456', recoveryCode: 'r-1' },
      },
      'callback',
    );

    const entry = JSON.parse(lines[0] ?? '{}');
    expect(entry.req.query).toEqual({ code: '[Redacted]', state: 's1' });
    expect(entry.body).toEqual({
      otp: '[Redacted]',
      recoveryCode: '[Redacted]',
    });
  });

  it('redactUrl hides sensitive query values but keeps the rest', () => {
    expect(redactUrl('/auth/oidc/google/callback?code=abc&state=xyz')).toBe(
      '/auth/oidc/google/callback?code=%5BRedacted%5D&state=xyz',
    );
    expect(redactUrl('/health')).toBe('/health');
    expect(redactUrl(undefined)).toBeUndefined();
  });

  it('uses LOG_LEVEL', () => {
    const { logger, lines } = capture('warn');

    logger.info('dropped');
    logger.warn('kept');

    expect(lines).toHaveLength(1);
  });

  it('reuses the request id from the request context', () => {
    const ctx = new RequestContext();
    const options = buildPinoHttpOptions(testConfigFor('info'), ctx);

    const id = ctx.run(
      {
        requestId: 'req-12345678',
        ip: undefined,
        userAgent: undefined,
        actorId: undefined,
      },
      () => options.genReqId?.({} as never, {} as never),
    );

    expect(id).toBe('req-12345678');
  });
});
