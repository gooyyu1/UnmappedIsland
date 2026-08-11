import { describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import type { WorldObject } from '../../src/domain/runtime/WorldObject';
import { WorldSession } from '../../src/domain/runtime/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { YamlLoadError } from '../../src/loader/YamlLoadError';

/**
 * 量的オブジェクト（quantitative、GameElementDefinition.md 7.6節）に対する自動テスト。
 * 「volumeが正であること」と「インスタンスが存在すること」が同値、という不変条件を確かめる。
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
        cell_count: 1
        cell: {accept: {tag: liquid}}
        capacity: 1000

  jar:
    traits: [liquid_container]
    slots:
      content:
        cell_count: 1
        cell: {accept: {tag: liquid}}
        capacity: 4000

  water:
    traits: [liquid]
    props:
      volume: {value: 0}

  tea:
    traits: [liquid]
    props:
      volume: {value: 0}
`;

  function build(): {
    codex: WorldCodex;
    session: WorldSession;
    volumeId: number;
    contentId: number;
    spawnLiquid: (containerName: string, liquidName: string, volume: number) => [WorldObject, WorldObject];
  } {
    const codex = new WorldCodexYamlLoader().load('liquids.yaml', yaml).build();
    const session = new WorldSession(codex);
    const volumeId = codex.propertyNames.getId('volume');
    const contentId = codex.slotNames.getId('content');

    const spawnLiquid = (
      containerName: string,
      liquidName: string,
      volume: number,
    ): [WorldObject, WorldObject] => {
      const container = session.spawn(codex.objectNames.getId(containerName));
      const liquid = session.spawn(codex.objectNames.getId(liquidName));
      liquid.setNumber(volumeId, volume, session);
      expect(liquid.moveToSlot(container, contentId, codex.wellKnown)).toBeUndefined();
      return [container, liquid];
    };

    return { codex, session, volumeId, contentId, spawnLiquid };
  }

  function contentOf(container: WorldObject, codex: WorldCodex): readonly WorldObject[] {
    return container.getSlotByLocalId(container.def.slotLayout.toLocal(codex.slotNames.getId('content')))
      .contents;
  }

  it('同種へ注ぐと、量が加算され注ぎ元のインスタンスは消える', () => {
    const { codex, session, volumeId, spawnLiquid } = build();
    const [, receiver] = spawnLiquid('canteen', 'water', 300);
    const [source, poured] = spawnLiquid('jar', 'water', 200);

    expect(receiver.tryExecuteCombination(poured, undefined, 'pour_in', session)).toBe(true);

    expect(receiver.getNumber(volumeId), '受け側に全量が加算される').toBe(500);
    expect(poured.parent, '空になった注ぎ元は消える').toBeUndefined();
    expect(contentOf(source, codex), '注ぎ元の容器は空になる').toHaveLength(0);
  });

  it('注ぎ先が空なら、その量の新しいインスタンスが生まれる', () => {
    const { codex, session, volumeId, spawnLiquid } = build();
    const empty = session.spawn(codex.objectNames.getId('canteen'));
    const [, poured] = spawnLiquid('jar', 'water', 400);

    expect(empty.tryExecuteCombination(poured, undefined, 'pour_in', session)).toBe(true);

    const born = contentOf(empty, codex);
    expect(born, '注ぎ先に1つ生まれる').toHaveLength(1);
    expect(born[0], '移動ではなく新しいインスタンス').not.toBe(poured);
    expect(born[0].getNumber(volumeId)).toBe(400);
    expect(poured.parent, '注ぎ元は消える').toBeUndefined();
  });

  it('capacityに入りきらない量は注ぎ元に残る', () => {
    const { codex, session, volumeId, spawnLiquid } = build();
    const empty = session.spawn(codex.objectNames.getId('canteen')); // capacity 1000
    const [, poured] = spawnLiquid('jar', 'water', 4000);

    expect(empty.tryExecuteCombination(poured, undefined, 'pour_in', session)).toBe(true);

    expect(contentOf(empty, codex)[0].getNumber(volumeId), '入る分だけ入る').toBe(1000);
    expect(poured.getNumber(volumeId), '残りは注ぎ元に留まる').toBe(3000);
    expect(poured.parent, '量が残っているので注ぎ元は消えない').not.toBeUndefined();
  });

  it('異種の液体はacceptsが拒むため何も起きない', () => {
    const { session, volumeId, spawnLiquid } = build();
    const [, receiver] = spawnLiquid('canteen', 'tea', 300);
    const [, poured] = spawnLiquid('jar', 'water', 200);

    expect(receiver.tryExecuteCombination(poured, undefined, 'pour_in', session)).toBe(true);

    expect(receiver.getNumber(volumeId), '受け側は変わらない').toBe(300);
    expect(poured.getNumber(volumeId), '注ぎ元も変わらない').toBe(200);
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
      volume: {value: 0}
      density: {value: {min: 0.9, max: 1.1}}
`,
        )
        .build();

    expect(loadBad).toThrow(YamlLoadError);
    expect(loadBad).toThrowError(/振り直される/);
  });
});

/**
 * 量を動かす経路（tickのaccumulateと、その場の書き換え）はどれも行き先のスロットの上限も下限も
 * 知らないため、エンジンが不変条件へ戻す（WorldObject.settleVolume）。降雨で増える水・蒸発で
 * 減る水・飲み干した水が実際に頼っているのはこの2つ。
 */
describe('量的オブジェクトの量の変化', () => {
  const yaml = `
traits:
  liquid:
    tags: [liquid]
    quantitative: true
    props:
      volume: {value: 1}

object_defs:
  cup:
    slots:
      content:
        cell_count: 1
        cell: {accept: {tag: liquid}}
        capacity: 100

  puddle:
    slots:
      content:
        cell_count: 1
        cell: {accept: {tag: liquid}}

  rainwater:
    traits: [liquid]
    passives:
      - accumulate:
          self:
            volume: 30

  drying_water:
    traits: [liquid]
    passives:
      - accumulate:
          self:
            volume: -30

  still_water:
    traits: [liquid]
`;

  function build(): { codex: WorldCodex; session: WorldSession; volumeId: number; contentId: number } {
    const codex = new WorldCodexYamlLoader().load('tick.yaml', yaml).build();
    return {
      codex,
      session: new WorldSession(codex),
      volumeId: codex.propertyNames.getId('volume'),
      contentId: codex.slotNames.getId('content'),
    };
  }

  function fill(
    containerName: string,
    liquidName: string,
    volume: number,
  ): { container: WorldObject; liquid: WorldObject; session: WorldSession; volumeId: number } {
    const { codex, session, volumeId, contentId } = build();
    const container = session.spawn(codex.objectNames.getId(containerName));
    const liquid = session.spawn(codex.objectNames.getId(liquidName));
    liquid.setNumber(volumeId, volume, session);
    expect(liquid.moveToSlot(container, contentId, codex.wellKnown)).toBeUndefined();
    return { container, liquid, session, volumeId };
  }

  it('capacityを超えて増えた分はあふれて失われる', () => {
    const { liquid, session, volumeId } = fill('cup', 'rainwater', 90); // capacity 100

    liquid.tick(session);

    expect(liquid.getNumber(volumeId)).toBe(100);
  });

  it('上限の無いスロットでは、いくら増えても止まらない', () => {
    const { liquid, session, volumeId } = fill('puddle', 'rainwater', 90);

    liquid.tick(session);

    expect(liquid.getNumber(volumeId)).toBe(120);
  });

  it('量が尽きたインスタンスは消える', () => {
    const { liquid, session } = fill('cup', 'drying_water', 20);

    liquid.tick(session);

    expect(liquid.parent).toBeUndefined();
  });

  it('量を0にした時点で消える（次のtickを待たない）', () => {
    // 飲み干した水が0mLのまま残っていると、その間だけ「空なのに中身がいる容器」が見えてしまう。
    const { liquid, session, volumeId } = fill('cup', 'rainwater', 20);

    liquid.addNumber(volumeId, -20, session);

    expect(liquid.parent, 'tickを回すまでもなく容器から消える').toBeUndefined();
  });

  it('sessionを渡さない書き換えは、その場では畳まない（tickでの判定に任せる）', () => {
    const { container, liquid, session, volumeId } = fill('cup', 'still_water', 20);

    liquid.setNumber(volumeId, 0);

    expect(liquid.parent, 'range判定と同じく、判定はtickまで持ち越す').toBe(container);

    liquid.tick(session);

    expect(liquid.parent).toBeUndefined();
  });
});
