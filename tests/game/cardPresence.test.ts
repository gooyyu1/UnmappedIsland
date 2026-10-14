import { describe, expect, it, vi } from 'vitest';
import type { Card, CardContent } from '../../src/game/ui/Card';

// phaserはブラウザの外では読めない。Cardの読み込みに要るのは、継承元のクラスが在ることだけ。
vi.mock('phaser', () => ({ default: { GameObjects: new Proxy({}, { get: () => class {} }) } }));

/**
 * 枠に今在るインスタンス（Card.setPresence・presentIds）の自動テスト。
 *
 * 描画は見ない。setPresenceが描き直しに使う口は何もしないものへ差し替え、確かめるのは
 * **札が名乗る顔ぶれが、言われたときのまま動かないこと**だけ。
 */
describe('枠に今在るインスタンス', () => {
  /** 描かない札。isAliveが見るsceneと、setPresenceが呼ぶ描き直しの口だけを持つ。 */
  const cardShowing = async (content: CardContent): Promise<Card> => {
    const { Card } = await import('../../src/game/ui/Card');
    return Object.assign(Object.create(Card.prototype) as Card, {
      scene: {},
      _content: content,
      setContent: () => {},
      setVisible: () => {},
      setAlpha: () => {},
    });
  };

  it('渡した側が後から配列を書き換えても、名乗る顔ぶれは動かない', async () => {
    const card = await cardShowing({ icon: '', name: '石', identity: [1, 2, 3], count: 3 });
    const ids = [1, 2];

    card.setPresence(ids, false);
    ids.push(9);

    expect(card.presentIds, '受け取ったときに写しているので、渡した配列とは別').toEqual([1, 2]);
  });

  it('まだ言われていなければ、映している内容の並びそのものを渡す', async () => {
    const identity = [1, 2, 3];
    const card = await cardShowing({ icon: '', name: '石', identity, count: 3 });

    expect(card.presentIds, '詰め替えずに渡す').toBe(identity);
  });

  it('読んだ並びは、次に言われる前の顔ぶれのまま', async () => {
    const card = await cardShowing({ icon: '', name: '石', identity: [1, 2, 3], count: 3 });
    card.setPresence([1, 2], false);

    const read = card.presentIds;
    expect(read, '読むたびに詰め替えない').toBe(card.presentIds);
    card.setPresence([1], true);

    expect(read, '言い直しても、読んだ並びは前の顔ぶれのまま').toEqual([1, 2]);
    expect(card.presentIds, '読み直せば今の顔ぶれが返る').toEqual([1]);
  });
});
