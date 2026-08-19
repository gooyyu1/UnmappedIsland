import { beforeEach, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { Location } from '../../src/domain/views/Location';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * 土地のアイテムスロット（前詰めスロット）の並びに対する自動テスト。フィールドアイテムレーンで
 * カードをドラッグ＆ドロップしたときの挙動にあたる。
 */
describe('フィールドアイテムの並び', () => {
  const YAML = `
object_defs:
  clearing:
    slots:
      items:
        cell: {accept: {tag: item}}
  a: {tags: [item]}
  b: {tags: [item]}
  c: {tags: [item]}
`;

  let codex: WorldCodex;
  let session: WorldSession;
  let location: Location;

  /** 名前でアイテムを1つ生成する（まだどこにも属していない）。 */
  function item(name: string): WorldObject {
    return session.spawn(codex.objectNames.getId(name));
  }

  /** 並んでいるスタックをobject_defの名前で表す（同種2個なら'a×2'）。 */
  function items(): string[] {
    return location.itemStacks.map((stack) => `${stack[0].def.name}×${stack.length}`);
  }

  /** 名前の順に末尾から並べる（同種はスタックにまとまる）。 */
  function fill(...names: string[]): WorldObject[] {
    return names.map((name) => {
      const spawned = item(name);
      expect(location.receiveItem(spawned, session)).toBe(true);
      return spawned;
    });
  }

  beforeEach(() => {
    codex = new WorldCodexYamlLoader().load('core.yaml', YAML).build();
    session = new WorldSession(codex);
    location = new Location(session.spawn(codex.objectNames.getId('clearing')), codex);
  });

  it('同種のアイテムは1つのスタックにまとまる', () => {
    fill('a', 'b', 'a');

    expect(items()).toEqual(['a×2', 'b×1']);
    expect(location.items, 'スタックを畳み込まないビューは1個ずつ並べる').toHaveLength(3);
  });

  it('並び替えはスタックを丸ごと、指定した隙間へ動かす', () => {
    const [a] = fill('a', 'b', 'c', 'a');

    expect(location.reorderItems(a, 3), 'cの右へ動かす').toBe(true);

    expect(items()).toEqual(['b×1', 'c×1', 'a×2']);
  });

  it('左向きの並び替えでは、落とした隙間の右へ入る', () => {
    const [, , c] = fill('a', 'b', 'c');

    expect(location.reorderItems(c, 1), 'aとbの隙間へ動かす').toBe(true);

    expect(items()).toEqual(['a×1', 'c×1', 'b×1']);
  });

  it('自分の両隣の隙間へ落としても並びは変わらない', () => {
    const [, b] = fill('a', 'b', 'c');

    expect(location.reorderItems(b, 1)).toBe(true);
    expect(location.reorderItems(b, 2)).toBe(true);

    expect(items()).toEqual(['a×1', 'b×1', 'c×1']);
  });

  it('位置を指定した受け入れは、その隙間へ入る（前詰めなので押し出しは要らない）', () => {
    fill('a', 'b');

    expect(location.receiveItem(item('c'), session, 1)).toBe(true);

    expect(items()).toEqual(['a×1', 'c×1', 'b×1']);
  });

  it('位置を指定しても、同種のアイテムは既存スタックへ合流する', () => {
    fill('a', 'b');

    expect(location.receiveItem(item('b'), session, 0)).toBe(true);

    expect(items()).toEqual(['a×1', 'b×2']);
  });
});
