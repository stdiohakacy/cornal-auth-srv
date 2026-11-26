import { newId, parseId } from './id.js';

describe('id', () => {
  it('newId is a UUIDv7', () => {
    expect(newId<'X'>()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('parseId rejects non-uuid', () => {
    expect(parseId<'X'>('not-a-uuid')).toBeUndefined();
    const id = newId<'X'>();
    expect(parseId<'X'>(id)).toBe(id);
  });
});
