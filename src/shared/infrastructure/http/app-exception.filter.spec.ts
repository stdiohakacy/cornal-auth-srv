import type { ArgumentsHost } from '@nestjs/common';
import { RequestContext } from '../request-context/request-context.js';
import { AppExceptionFilter } from './app-exception.filter.js';

describe('AppExceptionFilter', () => {
  it('rethrows outside HTTP instead of writing an HTTP response', () => {
    const filter = new AppExceptionFilter(new RequestContext());
    const switchToHttp = vi.fn<() => unknown>();
    const host = {
      getType: () => 'rpc',
      switchToHttp,
    } as unknown as ArgumentsHost;
    const error = new Error('rpc failure');

    expect(() => filter.catch(error, host)).toThrow(error);
    expect(switchToHttp).not.toHaveBeenCalled();
  });
});
