import { describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * 「まとめて何個入るか」の問い（WorldObject.acceptedCountForMoveToIncludingSelf）に対する自動テスト。
 *
 * 束をコンテナへまとめて落とす操作は、この答えをそのまま「ついてくる枚数」にする
 * （CardInteraction.md 2節 カードのドラッグ＆ドロップ）。入らないぶんは最初からついてこない、という
 * 約束が成り立つかを確かめる。
 */
describe('まとめて入る個数', () => {
  const codex: WorldCodex = new WorldCodexYamlLoader()
    .load(
      'baskets.yaml',
      `
object_defs:
  basket:
    slots:
      contents:
        cell_count: 2
        cell: {accept: {tag: item}, max: 3}

  sack:
    # 枠数を決めていないので、いくつでも入る。
    slots:
      contents:
        cell: {accept: {tag: item}}

  crate:
    slots:
      contents:
        cell_count: 4
        cell: {accept: {tag: item}}
        capacity: 5

  coconut:
    tags: [item]
    props:
      volume: {value: 2}

  jar:
    tags: [item]
    stackable: false

  stone: {}
`,
    )
    .buildAndReset();

  const contentsId = codex.slotNames.getId('contents');

  /** ownerNameの入れ物と、まだどこにも入っていないitemNameのcount個。 */
  function open(ownerName: string, itemName: string, count: number): [WorldObject, WorldObject[]] {
    const session = new WorldSession(codex);
    const owner = session.createObject(codex.objectNames.getId(ownerName));
    const items = Array.from({ length: count }, () =>
      session.createObject(codex.objectNames.getId(itemName)),
    );
    return [owner, items];
  }

  /** itemsのうち何個がownerのcontentsへ続けて入るか。 */
  function accepted(owner: WorldObject, items: readonly WorldObject[]): number {
    return items[0].acceptedCountForMoveToIncludingSelf(items.slice(1), owner.getSlot(contentsId));
  }

  it('枠のmaxと枠の数を掛けたところで頭打ちになる', () => {
    const [basket, coconuts] = open('basket', 'coconut', 10);

    expect(accepted(basket, coconuts), '3個の枠が2つ').toBe(6);
  });

  it('既に入っているぶんだけ減る', () => {
    const [basket, coconuts] = open('basket', 'coconut', 10);
    expect(coconuts[0].moveToSlotOrRejection(basket.getSlot(contentsId))).toBeUndefined();

    expect(accepted(basket, coconuts.slice(1)), '1つ入れたので残りは5').toBe(5);
  });

  it('枠数が決まっていない入れ物は、持っているだけ全部入る', () => {
    const [sack, coconuts] = open('sack', 'coconut', 10);

    expect(accepted(sack, coconuts)).toBe(10);
  });

  it('かさの上限（capacity）が枠より先に尽きればそちらで止まる', () => {
    // 枠は4つ空いているが、1個2のかさなので合計5を超えられない。
    const [crate, coconuts] = open('crate', 'coconut', 4);

    expect(accepted(crate, coconuts)).toBe(2);
  });

  it('束ねない型は、空いている枠の数しか入らない', () => {
    const [basket, jars] = open('basket', 'jar', 5);

    expect(accepted(basket, jars), 'maxが3でも1枠に1個').toBe(2);
  });

  it('受け入れない型は0個', () => {
    const [basket, stones] = open('basket', 'stone', 3);

    expect(accepted(basket, stones)).toBe(0);
  });

  it('1個も入らないなら0で、1個だけ入るかを訊いた答えと食い違わない', () => {
    const [basket, coconuts] = open('basket', 'coconut', 7);
    for (const coconut of coconuts.slice(0, 6))
      expect(coconut.moveToSlotOrRejection(basket.getSlot(contentsId))).toBeUndefined();

    const last = coconuts[6];
    expect(accepted(basket, [last])).toBe(0);
    expect(last.rejectionForMoveTo(basket.getSlot(contentsId))).toBeDefined();
  });
});
