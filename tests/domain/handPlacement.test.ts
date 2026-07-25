import { beforeEach, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import type { WorldObject } from '../../src/domain/runtime/WorldObject';
import { WorldSession } from '../../src/domain/runtime/WorldSession';
import { PlayerCharacter } from '../../src/domain/runtime/views/PlayerCharacter';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * 手持ち（固定枠スロット）へ位置を指定して入れる手動配置（PlayerCharacter.take・Slot.tryInsertAtGap）の
 * 自動テスト。カードを隙間へドラッグ＆ドロップしたときの挙動にあたる。
 */
describe('手持ちへの位置指定の配置', () => {
  const YAML = `
object_defs:
  character:
    singleton: true
    slots:
      hand:
        accepts:
          - {tag: item, max: 9999}
        unit_capacity: 6
        fixed_positions: true
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
    return session.spawn(codex.objectNames.getId(name));
  }

  /** 手持ちの中身をobject_defの名前で並べる（空き枠は'_'）。 */
  function hand(): string[] {
    return player.hand.map((held) => held?.def.name ?? '_');
  }

  /** 名前の順に手持ちの先頭から詰める。 */
  function fill(...names: string[]): WorldObject[] {
    return names.map((name) => {
      const spawned = item(name);
      expect(player.take(spawned, session)).toBe(true);
      return spawned;
    });
  }

  beforeEach(() => {
    codex = new WorldCodexYamlLoader().load('core.yaml', YAML).build();
    session = new WorldSession(codex);
    player = new PlayerCharacter(session.spawn(codex.objectNames.getId('character')), codex);
  });

  it('gapIndexを省略すると最初の空き枠へ入る', () => {
    const [, b] = fill('a', 'b', 'c');
    b.destroy(codex.wellKnown);

    expect(player.take(item('d'), session)).toBe(true);

    expect(hand()).toEqual(['a', 'd', 'c', '_', '_', '_']);
  });

  it('隙間へ入れるとき、まず右方向へ既存の枠を押し出す', () => {
    fill('a', 'b', 'c', 'd', 'e');

    expect(player.take(item('g'), session, 2)).toBe(true);

    expect(hand()).toEqual(['a', 'b', 'g', 'c', 'd', 'e']);
  });

  it('右に空きが無ければ、左方向へ押し出して隙間の左隣へ入る', () => {
    const [a] = fill('a', 'b', 'c', 'd', 'e', 'f');
    a.destroy(codex.wellKnown);
    expect(hand(), '左端だけが空いた状態を作る').toEqual(['_', 'b', 'c', 'd', 'e', 'f']);

    expect(player.take(item('g'), session, 3)).toBe(true);

    expect(hand()).toEqual(['b', 'c', 'g', 'd', 'e', 'f']);
  });

  it('空きセルの位置へ入れると、他の枠を動かさずにそのセルへ入る', () => {
    const [, b] = fill('a', 'b', 'c');
    b.destroy(codex.wellKnown);

    expect(player.take(item('g'), session, 1)).toBe(true);

    expect(hand()).toEqual(['a', 'g', 'c', '_', '_', '_']);
  });

  it('同種のアイテムは、指定した位置より既存スタックへの合流が優先される', () => {
    const [a] = fill('a', 'b');

    expect(player.take(item('a'), session, 4)).toBe(true);

    expect(hand(), '空いた枠は使わない').toEqual(['a', 'b', '_', '_', '_', '_']);
    expect(player.hand[0], '先頭の枠は同種2個のスタックになっている').toBe(a);
  });

  it('6枠とも埋まっていれば、隙間へ入れることもできない', () => {
    fill('a', 'b', 'c', 'd', 'e', 'f');
    const g = item('g');

    expect(player.take(g, session, 3)).toBe(false);

    expect(hand()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(g.parent, '失敗したので入れ替わりもしない').toBeUndefined();
  });
});
