import { CommonErrorCode } from '#src/contracts/error-codes.js';
import { DomainError } from '#src/shared/domain/domain-error.js';
import { err, ok } from '#src/shared/domain/result.js';
import { httpStatusToCode } from './error-status.js';
import { unwrap } from './unwrap.js';

class TestConflictError extends DomainError<typeof CommonErrorCode.Conflict> {
  readonly code = CommonErrorCode.Conflict;
}

describe('unwrap', () => {
  it('unwrap returns the value of ok', () => {
    expect(unwrap(ok(42))).toBe(42);
  });

  it('unwrap throws the same DomainError instance on err', () => {
    const error = new TestConflictError('taken');
    expect(() => unwrap(err(error))).toThrow(error);
  });
});

describe('httpStatusToCode', () => {
  it('httpStatusToCode maps 404 to COMMON.NOT_FOUND', () => {
    expect(httpStatusToCode(404)).toBe('COMMON.NOT_FOUND');
  });

  it('httpStatusToCode maps 418 to COMMON.BAD_REQUEST', () => {
    expect(httpStatusToCode(418)).toBe('COMMON.BAD_REQUEST');
  });

  it('httpStatusToCode maps 502 to COMMON.INTERNAL', () => {
    expect(httpStatusToCode(502)).toBe('COMMON.INTERNAL');
  });
});
