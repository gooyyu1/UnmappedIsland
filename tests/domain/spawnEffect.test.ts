import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * spawn（GameElementDefinition.md 9.4節）が生むオブジェクトの初期値の検証。`same_slot`が引き継ぐのは
 * 置き換え位置だけで、プロパティの値は生まれた型自身の宣言（6.2節）で決まる。
 */
describe('spawnの初期値', () => {
  // 4000gの素材を加工して400gの物が2つできる連鎖。加工前後の型が同じ`weight`を宣言している。
  const yaml = `
object_defs:
  workbench:
    slots:
      items: {}
  raw_material:
    props:
      weight: {value: 4000}
      life:
        value: 0
        range: {min: 0, max: 2147483647}
        on_min:
          destroy: self
          spawn: {object: crafted_part, count: 2}
  crafted_part:
    props:
      weight: {value: 400}
`;

  let codex: WorldCodex;
  let weightId: number;

  beforeAll(() => {
    codex = new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset();
    weightId = codex.propertyNames.getId('weight');
  });

  /** 素材をworkbenchへ置いて加工を発火させ、置き換わった中身を返す。 */
  function craft(): readonly WorldObject[] {
    const session = new WorldSession(codex);
    const itemsSlotId = codex.slotNames.getId('items');

    const bench = new WorldObject(1, codex.objects.get(codex.objectNames.getId('workbench')), session);
    const material = new WorldObject(2, codex.objects.get(codex.objectNames.getId('raw_material')), session);
    material.moveToSlotOrRejection(bench.getSlot(itemsSlotId));

    // lifeがrangeの下限を割っているので、tickでon_min（destroy+spawn）が発火する。
    bench.tick();

    return bench.tryGetSlot(itemsSlotId)!.contents;
  }

  it('same_slotで生まれた物の重さは、元の物ではなく自分の型の宣言で決まる', () => {
    const parts = craft();

    expect(parts.map((part) => part.def.name)).toEqual(['crafted_part', 'crafted_part']);
    // 元の素材の4000gを引き継がない。countで複数生まれても、重さは増えも分かれもしない。
    expect(parts.map((part) => part.tryGetProperty(weightId)?.number ?? 0)).toEqual([400, 400]);
  });
});

/**
 * spawnの配置先（9.4節）が、**moveの移動先と同じ三択**で書けることの検証。`into`（対象キー）のほかに、
 * 型（`into_object`。名前をその場に書いても、型を値に持つプロパティから引いてもよい、6.9節）と、
 * プロパティが持つインスタンスID（`into_prop`）で指せる——どちらも「自分でも操作者でもない、離れた
 * 1つの相手」で、対象キーでは名指せない。
 */
describe('spawnの配置先', () => {
  const yaml = `
object_defs:
  ground:
    slots:
      fixtures: {}
  depot:
    singleton: true
    slots:
      items: {}
  box:
    slots:
      items: {}
  marker: {}
  emitter:
    props:
      target_id: {value: 0}
      # 型を値に持つプロパティ（6.9節）。into_objectがここから行き先の型を引く。
      target_type: {value: {object: depot}}
      fuse:
        value: 0
        range: {min: 0, max: 2147483647}
        on_min:
          spawn:
            - {object: marker, into_object: depot}
            - {object: marker, into_prop: target_id}
            - {object: marker, into_object: {prop: target_type}}
`;

  let codex: WorldCodex;

  beforeAll(() => {
    codex = new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset();
  });

  it('型の名前とプロパティの持つインスタンスIDで、離れた相手のスロットへ入れられる', () => {
    const session = new WorldSession(codex);
    const fixturesSlotId = codex.slotNames.getId('fixtures');
    const itemsSlotId = codex.slotNames.getId('items');
    const create = (name: string, instanceId: number): WorldObject =>
      new WorldObject(instanceId, codex.objects.get(codex.objectNames.getId(name)), session);

    const ground = create('ground', 1);
    const depot = create('depot', 2);
    const box = create('box', 3);
    const emitter = create('emitter', 4);
    for (const object of [depot, box, emitter])
      expect(object.moveToSlotOrRejection(ground.getSlot(fixturesSlotId))).toBeUndefined();
    emitter.getProperty(codex.propertyNames.getId('target_id')).setNumberWithoutEvents(box.instanceId);

    // fuseがrangeの下限を割っているので、tickでon_min（spawn2つ）が発火する。
    ground.tick();

    expect(
      depot.tryGetSlot(itemsSlotId)!.contents.map((object) => object.def.name),
      'into_objectはその型のインスタンスへ入れる（名前で書いても、プロパティから引いても同じ）',
    ).toEqual(['marker', 'marker']);
    expect(
      box.tryGetSlot(itemsSlotId)!.contents.map((object) => object.def.name),
      'into_propはそのIDの個体へ入れる',
    ).toEqual(['marker']);
  });
});
