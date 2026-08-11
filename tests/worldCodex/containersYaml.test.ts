import { beforeAll, describe, expect, it } from 'vitest';
import type { ObjectDef } from '../../src/domain/defs/ObjectDef';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { WorldObject } from '../../src/domain/runtime/WorldObject';
import { WorldSession } from '../../src/domain/runtime/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * 固形物のかさ（size）と入れ物の容量（capacity）を、実ファイルの定義だけで検証する
 * （docs/engine/ContainerSystem.md 7節）。
 */
describe('固形物のかさと入れ物の容量', () => {
  let codex: WorldCodex;
  let sizeId: number;
  let itemTagId: number;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
    sizeId = codex.propertyNames.getId('size');
    itemTagId = codex.tagNames.getId('item');
  });

  /** 持ち歩ける物（itemタグ）の型。製作中オブジェクトは自動生成なので除く。 */
  function itemDefs(): ObjectDef[] {
    const defs: ObjectDef[] = [];
    for (let globalId = 0; globalId < codex.objects.count; globalId++) {
      const def = codex.objects.get(globalId);
      if (!def.tags.includes(itemTagId)) continue;
      if (codex.productOf(def) !== undefined) continue;
      defs.push(def);
    }
    return defs;
  }

  it('持ち歩ける物はすべてかさを宣言している', () => {
    // 宣言し忘れた物はかさ0として扱われ、入れ物へ無限に入ってしまう。数が増えても気付けるよう、
    // ここで全数を検査する（絵の名前を検査するobjectArt.test.tsと同じ理由）。
    const missing = itemDefs()
      .filter((def) => def.getPropertyDef(sizeId) === undefined)
      .map((def) => def.name);

    expect(missing, 'sizeを持たないitem').toEqual([]);
  });

  it('かさは重さと釣り合っている（見かけの密度が石より重くならない）', () => {
    // sizeは実占有体積ではなく外接直方体なので、見かけの密度は実際の比重より必ず小さく出る。
    // 石（花崗岩 2.7g/mL）を超える値が出たら、どちらかの数値が桁違いになっている。
    const weightId = codex.propertyNames.getId('weight');
    const session = new WorldSession(codex);

    for (const def of itemDefs()) {
      const instance = new WorldObject(1, def, session);
      const size = instance.getNumber(sizeId);
      const weight = instance.getNumber(weightId);

      expect(size, `${def.name} のかさ`).toBeGreaterThan(0);
      expect(weight / size, `${def.name} の見かけの密度`).toBeLessThan(2.7);
    }
  });

  it('編み籠は自分の容量より大きいので、籠の中へ籠は入らない', () => {
    // 入れ子を禁じるエンジン側の規則は自己包含だけ（GameElementDefinition.md 7.1節）。
    // 「別の籠なら入る」を止めているのはかさと容量で、そこに専用の禁止規則は要らない。
    const basket = codex.objects.get(codex.objectNames.getId('woven_basket'));
    const session = new WorldSession(codex);
    const outer = session.spawn(basket.globalId);
    const inner = session.spawn(basket.globalId);

    expect(inner.moveToSlot(outer, codex.slotNames.getId('contents'), codex.wellKnown)).toContain('容量');
  });

  it('編み籠には熟したヤシの実が2個入り、3個は入らない', () => {
    // 20Lの籠に7Lの実。隙間なく詰められないことは、かさを外接直方体で見積もることで表れる。
    const session = new WorldSession(codex);
    const basket = session.spawn(codex.objectNames.getId('woven_basket'));
    const contentsId = codex.slotNames.getId('contents');
    const put = (): string | undefined =>
      session.spawn(codex.objectNames.getId('coconut')).moveToSlot(basket, contentsId, codex.wellKnown);

    expect(put(), '1個目').toBeUndefined();
    expect(put(), '2個目').toBeUndefined();
    expect(put(), '3個目は容量を超える').toContain('容量');
  });

  it('ヤシの葉は1枚も籠に入らない', () => {
    // 葉のかさ（22L）は籠の容量（20L）を超える。持ち歩くなら手に持つほかない。
    const session = new WorldSession(codex);
    const basket = session.spawn(codex.objectNames.getId('woven_basket'));
    const frond = session.spawn(codex.objectNames.getId('palm_frond'));

    expect(frond.moveToSlot(basket, codex.slotNames.getId('contents'), codex.wellKnown)).toContain('容量');
  });
});
