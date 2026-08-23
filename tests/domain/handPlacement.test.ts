import { beforeEach, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { PlayerCharacter } from '../../src/domain/wrappers/PlayerCharacter';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * 手持ち（固定枠スロット）へ位置を指定して入れる手動配置と並び替えの自動テスト。カードを隙間
 * （PlayerCharacter.take・reorderHand）や空き枠（takeIntoCell・moveHandToCell）へドラッグ＆
 * ドロップしたときの挙動にあたる。
 */
describe('手持ちへの位置指定の配置', () => {
  const YAML = `
object_defs:
  character:
    singleton: true
    slots:
      hand:
        cell: {accept: {tag: item}}
        cell_count: 6
  a: {tags: [item]}
  b: {tags: [item]}
  c: {tags: [item]}
  d: {tags: [item]}
  e: {tags: [item]}
  f: {tags: [item]}
  g: {tags: [item]}
`;

  let codex: WorldCodex;
  let session: WorldSession;
  let player: PlayerCharacter;

  /** 名前でアイテムを1つ生成する（まだどこにも属していない）。 */
  function item(name: string): WorldObject {
    return session.createObject(codex.objectNames.getId(name));
  }

  /** 手持ちの中身をobject_defの名前で並べる（空き枠は'_'）。 */
  function hand(): string[] {
    return player.hand.map((held) => held?.def.name ?? '_');
  }

  /** 名前の順に手持ちの先頭から詰める。 */
  function fill(...names: string[]): WorldObject[] {
    return names.map((name) => {
      const spawned = item(name);
      expect(player.take(spawned)).toBe(true);
      return spawned;
    });
  }

  beforeEach(() => {
    codex = new WorldCodexYamlLoader().load('core.yaml', YAML).build();
    session = new WorldSession(codex);
    player = new PlayerCharacter(session.createObject(codex.objectNames.getId('character')), codex);
  });

  it('gapIndexを省略すると最初の空き枠へ入る', () => {
    const [, b] = fill('a', 'b', 'c');
    b.destroy();

    expect(player.take(item('d'))).toBe(true);

    expect(hand()).toEqual(['a', 'd', 'c', '_', '_', '_']);
  });

  it('隙間へ入れるとき、まず右方向へ既存の枠を押し出す', () => {
    fill('a', 'b', 'c', 'd', 'e');

    expect(player.take(item('g'), { kind: 'gap', index: 2 })).toBe(true);

    expect(hand()).toEqual(['a', 'b', 'g', 'c', 'd', 'e']);
  });

  it('右に空きが無ければ、左方向へ押し出して隙間の左隣へ入る', () => {
    const [a] = fill('a', 'b', 'c', 'd', 'e', 'f');
    a.destroy();
    expect(hand(), '左端だけが空いた状態を作る').toEqual(['_', 'b', 'c', 'd', 'e', 'f']);

    expect(player.take(item('g'), { kind: 'gap', index: 3 })).toBe(true);

    expect(hand()).toEqual(['b', 'c', 'g', 'd', 'e', 'f']);
  });

  it('空きセルの位置へ入れると、他の枠を動かさずにそのセルへ入る', () => {
    const [, b] = fill('a', 'b', 'c');
    b.destroy();

    expect(player.take(item('g'), { kind: 'gap', index: 1 })).toBe(true);

    expect(hand()).toEqual(['a', 'g', 'c', '_', '_', '_']);
  });

  it('同種のアイテムは、指定した位置より既存スタックへの合流が優先される', () => {
    const [a] = fill('a', 'b');

    expect(player.take(item('a'), { kind: 'gap', index: 4 })).toBe(true);

    expect(hand(), '空いた枠は使わない').toEqual(['a', 'b', '_', '_', '_', '_']);
    expect(player.hand[0], '先頭の枠は同種2個のスタックになっている').toBe(a);
  });

  it('並び替えは、スタックを丸ごと動かす（1個ずつでは元のスタックへ戻ってしまう）', () => {
    const [a] = fill('a', 'b', 'c');
    expect(player.take(item('a'))).toBe(true);
    expect(hand(), '同種2個は先頭の枠で1スタックになる').toEqual(['a', 'b', 'c', '_', '_', '_']);

    expect(a.reorderInParentSlot({ kind: 'gap', index: 3 }), 'cの右へ動かす').toBe(true);

    expect(hand()).toEqual(['b', 'c', 'a', '_', '_', '_']);
    expect(player.handStacks[2], '2個とも一緒に動く').toHaveLength(2);
  });

  it('並び替えでは、抜けた跡の側へ詰める', () => {
    const [, , c] = fill('a', 'b', 'c', 'd');

    expect(c.reorderInParentSlot({ kind: 'gap', index: 1 }), 'aとbの隙間へ左向きに動かす').toBe(true);

    expect(hand(), '跡（右側）へ詰めるので、bだけが右へずれる').toEqual(['a', 'c', 'b', 'd', '_', '_']);
  });

  it('自分の両隣の隙間へ落としても並びは変わらない', () => {
    const [, b] = fill('a', 'b', 'c');

    expect(b.reorderInParentSlot({ kind: 'gap', index: 1 })).toBe(true);
    expect(b.reorderInParentSlot({ kind: 'gap', index: 2 })).toBe(true);

    expect(hand()).toEqual(['a', 'b', 'c', '_', '_', '_']);
  });

  it('6枠とも埋まっていても並び替えはできる', () => {
    const [a] = fill('a', 'b', 'c', 'd', 'e', 'f');

    expect(a.reorderInParentSlot({ kind: 'gap', index: 3 })).toBe(true);

    expect(hand()).toEqual(['b', 'c', 'a', 'd', 'e', 'f']);
  });

  it('空き枠を指して入れると、その枠へ入る', () => {
    const [, b] = fill('a', 'b', 'c');
    b.destroy();

    expect(player.take(item('g'), { kind: 'cell', index: 1 })).toBe(true);

    expect(hand()).toEqual(['a', 'g', 'c', '_', '_', '_']);
  });

  it('埋まっている枠を指して入れることはできない', () => {
    fill('a', 'b');
    const g = item('g');

    expect(player.take(g, { kind: 'cell', index: 0 })).toBe(false);

    expect(hand()).toEqual(['a', 'b', '_', '_', '_', '_']);
    expect(g.parent, '失敗したので入れ替わりもしない').toBeUndefined();
  });

  it('空き枠を指しても、同種のアイテムは既存スタックへの合流が優先される', () => {
    fill('a', 'b');

    expect(player.take(item('a'), { kind: 'cell', index: 4 })).toBe(true);

    expect(hand(), '指した空き枠は使わない').toEqual(['a', 'b', '_', '_', '_', '_']);
    expect(player.handStacks[0]).toHaveLength(2);
  });

  it('空き枠への移動は、間の枠を動かさずにその枠へ移る', () => {
    const [a] = fill('a', 'b', 'c');

    expect(a.reorderInParentSlot({ kind: 'cell', index: 4 })).toBe(true);

    expect(hand()).toEqual(['_', 'b', 'c', '_', 'a', '_']);
  });

  it('6枠とも埋まっていれば、隙間へ入れることもできない', () => {
    fill('a', 'b', 'c', 'd', 'e', 'f');
    const g = item('g');

    expect(player.take(g, { kind: 'gap', index: 3 })).toBe(false);

    expect(hand()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(g.parent, '失敗したので入れ替わりもしない').toBeUndefined();
  });
});
