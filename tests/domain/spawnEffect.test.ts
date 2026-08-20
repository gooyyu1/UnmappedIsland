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
    codex = new WorldCodexYamlLoader().load('core.yaml', yaml).build();
    weightId = codex.propertyNames.getId('weight');
  });

  /** 素材をworkbenchへ置いて加工を発火させ、置き換わった中身を返す。 */
  function craft(): readonly WorldObject[] {
    const session = new WorldSession(codex);
    const itemsSlotId = codex.slotNames.getId('items');

    const bench = new WorldObject(1, codex.objects.get(codex.objectNames.getId('workbench')), session);
    const material = new WorldObject(2, codex.objects.get(codex.objectNames.getId('raw_material')), session);
    material.moveToSlot(bench, itemsSlotId);

    // lifeがrangeの下限を割っているので、tickでon_min（destroy+spawn）が発火する。
    bench.tick(session);

    return bench.tryGetSlot(itemsSlotId)!.contents;
  }

  it('same_slotで生まれた物の重さは、元の物ではなく自分の型の宣言で決まる', () => {
    const parts = craft();

    expect(parts.map((part) => part.def.name)).toEqual(['crafted_part', 'crafted_part']);
    // 元の素材の4000gを引き継がない。countで複数生まれても、重さは増えも分かれもしない。
    expect(parts.map((part) => part.getNumber(weightId))).toEqual([400, 400]);
  });
});
