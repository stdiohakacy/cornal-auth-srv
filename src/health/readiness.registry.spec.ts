import { ReadinessRegistry } from './readiness.registry.js';

describe('ReadinessRegistry', () => {
  it('rejects a second probe under the same name', () => {
    const registry = new ReadinessRegistry();
    registry.register('postgres', async () => true);

    expect(() => registry.register('postgres', async () => true)).toThrow(
      'Readiness probe "postgres" is already registered',
    );
  });
});
