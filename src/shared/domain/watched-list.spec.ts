import { WatchedList } from './watched-list.js';

class Tags extends WatchedList<string> {
  constructor(initial: readonly string[]) {
    super(initial);
  }
  protected same(a: string, b: string): boolean {
    return a === b;
  }
}

describe('WatchedList', () => {
  it('remove then add an initial item leaves added/removed empty', () => {
    const tags = new Tags(['a']);
    tags.remove('a');
    tags.add('a');
    expect(tags.added).toEqual([]);
    expect(tags.removed).toEqual([]);
  });

  it('add then remove a new item leaves added empty', () => {
    const tags = new Tags([]);
    tags.add('b');
    tags.remove('b');
    expect(tags.added).toEqual([]);
    expect(tags.removed).toEqual([]);
  });

  it('remove an initial item lists it in removed', () => {
    const tags = new Tags(['a', 'b']);
    tags.remove('a');
    expect(tags.removed).toEqual(['a']);
    expect(tags.items).toEqual(['b']);
  });
});
