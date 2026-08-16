import { describe, expect, it } from 'vitest';
import { Shelf } from '../../src/save/Shelf';
import { MemoryStorage } from '../support/MemoryStorage';

/** 持ち帰ったアーティファクトの棚（docs/concept/GameEndings.md 6節）。 */
describe('アーティファクトの棚', () => {
  it('何も持ち帰っていなければ空', () => {
    expect(new Shelf(new MemoryStorage()).contents).toEqual([]);
  });

  it('収めた物は残り、次に開いたときも並んでいる', () => {
    const storage = new MemoryStorage();

    expect(new Shelf(storage).add(['golden_chalice']), '新しく収まった物を返す').toEqual(['golden_chalice']);
    expect(new Shelf(storage).contents).toEqual(['golden_chalice']);
  });

  it('同じ物を2度持ち帰っても枠は増えない', () => {
    const storage = new MemoryStorage();
    new Shelf(storage).add(['golden_chalice']);

    expect(new Shelf(storage).add(['golden_chalice']), '増えた物は無い').toEqual([]);
    expect(new Shelf(storage).contents).toEqual(['golden_chalice']);
  });

  it('1回で複数を持ち帰っても、重複は畳まれる', () => {
    const storage = new MemoryStorage();

    expect(new Shelf(storage).add(['golden_chalice', 'golden_chalice'])).toEqual(['golden_chalice']);
    expect(new Shelf(storage).contents).toEqual(['golden_chalice']);
  });

  it('他タブや手動編集で壊れた値は、まだ何も無いとして読む', () => {
    const storage = new MemoryStorage();
    storage.setItem('unmapped-island:shelf', '{壊れている');

    expect(new Shelf(storage).contents).toEqual([]);
  });
});
