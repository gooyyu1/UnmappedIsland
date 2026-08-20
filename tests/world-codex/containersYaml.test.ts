import { beforeAll, describe, expect, it } from 'vitest';
import type { ObjectDef } from '../../src/domain/ObjectDef';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * 固形物のかさ（volume）と入れ物の容量（capacity）を、実ファイルの定義だけで検証する
 * （docs/engine/ContainerSystem.md 7節）。
 */
describe('固形物のかさと入れ物の容量', () => {
  let codex: WorldCodex;
  let volumeId: number;
  let itemTagId: number;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
    volumeId = codex.propertyNames.getId('volume');
    itemTagId = codex.tagNames.getId('item');
  });

  /** 持ち歩ける物（itemタグ）の型。製作中オブジェクトは自動生成なので除く。 */
  function itemDefs(): ObjectDef[] {
    const defs: ObjectDef[] = [];
    for (let globalId = 0; globalId < codex.objects.count; globalId++) {
      const def = codex.objects.get(globalId);
      if (!def.tags.includes(itemTagId)) continue;
      if (codex.isGenerated(def)) continue;
      defs.push(def);
    }
    return defs;
  }

  it('持ち歩ける物はすべてかさを宣言している', () => {
    // 宣言し忘れた物はかさ0として扱われ、入れ物へ無限に入ってしまう。数が増えても気付けるよう、
    // ここで全数を検査する（絵の名前を検査するobjectArt.test.tsと同じ理由）。
    const missing = itemDefs()
      .filter((def) => def.getPropertyDef(volumeId) === undefined)
      .map((def) => def.name);

    expect(missing, 'volumeを持たないitem').toEqual([]);
  });

  it('かさは重さと釣り合っている（見かけの密度が石より重くならない）', () => {
    // 小さい物のvolumeは外接直方体なので、見かけの密度は実際の比重より小さく出る。大きい物は実占有
    // 体積なので実際の比重に近い。石（花崗岩 2.7g/mL）を超える値が出たら、どちらかの数値が桁違い。
    const weightId = codex.propertyNames.getId('weight');
    const session = new WorldSession(codex);

    for (const def of itemDefs()) {
      const instance = new WorldObject(1, def, session);
      const volume = instance.tryGetProperty(volumeId)?.number ?? 0;
      const weight = instance.tryGetProperty(weightId)?.number ?? 0;

      expect(volume, `${def.name} のかさ`).toBeGreaterThan(0);
      expect(weight / volume, `${def.name} の見かけの密度`).toBeLessThan(2.7);
    }
  });

  it('編み籠は自分の容量より大きいので、籠の中へ籠は入らない', () => {
    // 入れ子を禁じるエンジン側の規則は自己包含だけ（GameElementDefinition.md 7.1節）。
    // 「別の籠なら入る」を止めているのはかさと容量で、そこに専用の禁止規則は要らない。
    const basket = codex.objects.get(codex.objectNames.getId('woven_basket'));
    const session = new WorldSession(codex);
    const outer = session.spawn(basket.globalId);
    const inner = session.spawn(basket.globalId);

    expect(inner.moveToSlot(outer, codex.slotNames.getId('contents'))).toContain('容量');
  });

  it('編み籠には熟したヤシの実が5個入り、6個は入らない', () => {
    // 20Lの籠に3.8Lの実。大きい物は実占有体積で見るので、隙間ぶんの割り増しは乗らない。
    const session = new WorldSession(codex);
    const basket = session.spawn(codex.objectNames.getId('woven_basket'));
    const contentsId = codex.slotNames.getId('contents');
    const put = (): string | undefined =>
      session.spawn(codex.objectNames.getId('coconut')).moveToSlot(basket, contentsId);

    for (let i = 0; i < 5; i++) expect(put(), `${i + 1}個目`).toBeUndefined();

    expect(put(), '6個目は容量を超える').toContain('容量');
  });

  it('編み籠には10種類まで入り、11種類目は入らない', () => {
    // 入れ物の枠数は手持ちの6枠を上回る（docs/world/Containers.md 1節）。かさの合計は5.3Lで
    // 容量（20L）に届かないので、ここで効いているのは枠数だけ。
    const kinds = [
      'stone',
      'sharp_stone',
      'twig',
      'bandage',
      'coconut_jelly',
      'coconut_meat',
      'coconut_half',
      'husked_coconut',
      'taro',
      'coconut_bowl',
    ];
    const session = new WorldSession(codex);
    const basket = session.spawn(codex.objectNames.getId('woven_basket'));
    const contentsId = codex.slotNames.getId('contents');
    const put = (name: string): string | undefined =>
      session.spawn(codex.objectNames.getId(name)).moveToSlot(basket, contentsId);

    expect(kinds.length, '手持ちの6枠を上回る').toBeGreaterThan(6);
    for (const name of kinds) expect(put(name), name).toBeUndefined();

    expect(put('water_spinach'), '11種類目は枠が無い').toBeDefined();
  });

  it('同じ種類なら1枠で、入るだけ重ねられる', () => {
    // 枠が制限するのは種類の数。同種はスタックにまとまるので、止めるのはかさと重さだけ。
    const session = new WorldSession(codex);
    const basket = session.spawn(codex.objectNames.getId('woven_basket'));
    const contentsId = codex.slotNames.getId('contents');

    for (let i = 0; i < 20; i++)
      expect(
        session.spawn(codex.objectNames.getId('stone')).moveToSlot(basket, contentsId),
        `${i + 1}個目の石`,
      ).toBeUndefined();

    const slot = basket.tryGetSlot(contentsId)!;
    expect(slot.contents, '20個すべて入る（かさ14L）').toHaveLength(20);
    expect(
      slot.cells.filter((cell) => cell !== undefined),
      '使っている枠は1つだけ',
    ).toHaveLength(1);
  });

  it('ヤシの葉は1枚も籠に入らない', () => {
    // 葉のかさ（22L）は籠の容量（20L）を超える。持ち歩くなら手に持つほかない。
    const session = new WorldSession(codex);
    const basket = session.spawn(codex.objectNames.getId('woven_basket'));
    const frond = session.spawn(codex.objectNames.getId('palm_frond'));

    expect(frond.moveToSlot(basket, codex.slotNames.getId('contents'))).toContain('容量');
  });
});
