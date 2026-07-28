import { describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import type { WorldObject } from '../../src/domain/runtime/WorldObject';
import { WorldSession } from '../../src/domain/runtime/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { YamlLoadError } from '../../src/loader/YamlLoadError';

/**
 * 量的オブジェクト（quantitative、GameElementDefinition.md 7.6節）に対する自動テスト。
 * 「sizeが正であること」と「インスタンスが存在すること」が同値、という不変条件を確かめる。
 */
describe('量的オブジェクトの移動', () => {
  const yaml = `
traits:
  liquid_container:
    represented_by: content
    combinations:
      # 受け側が空のとき（代表は容器自身）。中身入りのときは下のliquid側が発火する。
      pour_in:
        with: liquid
        move: {object: dragged, to: self}

  liquid:
    tags: [liquid]
    quantitative: true
    combinations:
      pour_in:
        with: liquid
        move: {object: dragged, to: parent}

object_defs:
  canteen:
    traits: [liquid_container]
    slots:
      content:
        accepts: [{tag: liquid, max: 1}]
        capacity: 1000

  jar:
    traits: [liquid_container]
    slots:
      content:
        accepts: [{tag: liquid, max: 1}]
        capacity: 4000

  water:
    traits: [liquid]
    props:
      size: {value: 0}

  tea:
    traits: [liquid]
    props:
      size: {value: 0}
`;

  function build(): {
    codex: WorldCodex;
    session: WorldSession;
    sizeId: number;
    contentId: number;
    spawnLiquid: (containerName: string, liquidName: string, size: number) => [WorldObject, WorldObject];
  } {
    const codex = new WorldCodexYamlLoader().load('liquids.yaml', yaml).build();
    const session = new WorldSession(codex);
    const sizeId = codex.propertyNames.getId('size');
    const contentId = codex.slotNames.getId('content');

    const spawnLiquid = (
      containerName: string,
      liquidName: string,
      size: number,
    ): [WorldObject, WorldObject] => {
      const container = session.spawn(codex.objectNames.getId(containerName));
      const liquid = session.spawn(codex.objectNames.getId(liquidName));
      liquid.setNumber(sizeId, size, session);
      expect(liquid.moveToSlot(container, contentId, codex.wellKnown)).toBeUndefined();
      return [container, liquid];
    };

    return { codex, session, sizeId, contentId, spawnLiquid };
  }

  function contentOf(container: WorldObject, codex: WorldCodex): readonly WorldObject[] {
    return container.getSlotByLocalId(container.def.slotLayout.toLocal(codex.slotNames.getId('content')))
      .contents;
  }

  it('同種へ注ぐと、量が加算され注ぎ元のインスタンスは消える', () => {
    const { codex, session, sizeId, spawnLiquid } = build();
    const [, receiver] = spawnLiquid('canteen', 'water', 300);
    const [source, poured] = spawnLiquid('jar', 'water', 200);

    expect(receiver.tryExecuteCombination(poured, undefined, 'pour_in', session)).toBe(true);

    expect(receiver.getNumber(sizeId), '受け側に全量が加算される').toBe(500);
    expect(poured.parent, '空になった注ぎ元は消える').toBeUndefined();
    expect(contentOf(source, codex), '注ぎ元の容器は空になる').toHaveLength(0);
  });

  it('注ぎ先が空なら、その量の新しいインスタンスが生まれる', () => {
    const { codex, session, sizeId, spawnLiquid } = build();
    const empty = session.spawn(codex.objectNames.getId('canteen'));
    const [, poured] = spawnLiquid('jar', 'water', 400);

    expect(empty.tryExecuteCombination(poured, undefined, 'pour_in', session)).toBe(true);

    const born = contentOf(empty, codex);
    expect(born, '注ぎ先に1つ生まれる').toHaveLength(1);
    expect(born[0], '移動ではなく新しいインスタンス').not.toBe(poured);
    expect(born[0].getNumber(sizeId)).toBe(400);
    expect(poured.parent, '注ぎ元は消える').toBeUndefined();
  });

  it('capacityに入りきらない量は注ぎ元に残る', () => {
    const { codex, session, sizeId, spawnLiquid } = build();
    const empty = session.spawn(codex.objectNames.getId('canteen')); // capacity 1000
    const [, poured] = spawnLiquid('jar', 'water', 4000);

    expect(empty.tryExecuteCombination(poured, undefined, 'pour_in', session)).toBe(true);

    expect(contentOf(empty, codex)[0].getNumber(sizeId), '入る分だけ入る').toBe(1000);
    expect(poured.getNumber(sizeId), '残りは注ぎ元に留まる').toBe(3000);
    expect(poured.parent, '量が残っているので注ぎ元は消えない').not.toBeUndefined();
  });

  it('異種の液体はacceptsが拒むため何も起きない', () => {
    const { session, sizeId, spawnLiquid } = build();
    const [, receiver] = spawnLiquid('canteen', 'tea', 300);
    const [, poured] = spawnLiquid('jar', 'water', 200);

    expect(receiver.tryExecuteCombination(poured, undefined, 'pour_in', session)).toBe(true);

    expect(receiver.getNumber(sizeId), '受け側は変わらない').toBe(300);
    expect(poured.getNumber(sizeId), '注ぎ元も変わらない').toBe(200);
  });

  it('quantitativeな型に生成時ロールの範囲値を使うとロードエラーになる', () => {
    const loadBad = (): WorldCodex =>
      new WorldCodexYamlLoader()
        .load(
          'bad.yaml',
          `
object_defs:
  water:
    quantitative: true
    props:
      size: {value: 0}
      density: {value: {min: 90, max: 110}}
`,
        )
        .build();

    expect(loadBad).toThrow(YamlLoadError);
    expect(loadBad).toThrowError(/振り直される/);
  });
});
