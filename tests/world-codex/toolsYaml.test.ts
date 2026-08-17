import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { WorldObject } from '../../src/domain/runtime/WorldObject';
import { WorldSession } from '../../src/domain/runtime/WorldSession';
import { Location } from '../../src/domain/runtime/views/Location';
import { World } from '../../src/domain/runtime/views/World';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * tools.yamlの道具定義と、素材から道具を作るcombinationの自動テスト。石を石へドラッグして
 * 尖った石にする流れ（locations.yamlのstone.combinations.knap）を、実ファイルの定義だけで検証する。
 */
describe('tools.yamlの道具定義', () => {
  let codex: WorldCodex;

  beforeAll(() => {
    // stoneはlocations.yaml、成果物のsharp_stoneはtools.yamlと、ファイルをまたぐ参照があるため
    // ディレクトリ全体を一括ロードする。
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
  });

  it('尖った石は、ものを切る道具のタグと武器のタグを持つ', () => {
    const sharpStone = codex.objects.get(codex.objectNames.getId('sharp_stone'));

    expect(sharpStone.tags).toContain(codex.tagNames.getId('item'));
    // 道具であること自体のタグ。能力のタグ（下）と重ねて付ける。
    expect(sharpStone.tags).toContain(codex.tagNames.getId('tool'));
    expect(sharpStone.tags).toContain(codex.tagNames.getId('cutting_tool'));
    // 動物へ重ねて殴れる（animals.yamlのstrikeがこのタグで探す、HuntingSystem.md 1.2節）。
    expect(sharpStone.tags).toContain(codex.tagNames.getId('weapon'));
  });

  it('尖った石は、満タンから始まる耐久度を持つ', () => {
    const session = new WorldSession(codex);
    const sharpStone = session.spawn(codex.objectNames.getId('sharp_stone'));

    const durability = sharpStone.readProperty(codex.propertyNames.getId('durability'));
    expect(durability?.ratio, '打ち出したばかりの刃は減っていない').toBe(1);
    expect(durability?.value, '上限は種類によらず統一（DurabilitySystem.md 1節）').toBe(960);
  });

  it('武器は、一撃がどこへ入るかの重み配分を宣言する', () => {
    // 武器が持つのは威力ではなく配分（HuntingSystem.md 1.2節）。合計を100に揃えるのは、
    // 仕留めの重み（無防備さ）と並ぶ目盛りを武器ごとに変えないため。**書き忘れは0と区別が
    // 付かない**ので、ここで合計を数えて捕まえる。
    const session = new WorldSession(codex);
    const shares = ['heavy_blow', 'light_blow', 'thrust', 'whiff'].map((name) =>
      codex.propertyNames.getId(name),
    );
    const weapons = codex.objectDefNamesWithTag('weapon');

    expect(weapons.length, '検査対象が無い（weaponタグが変わっていないか）').toBeGreaterThan(0);
    for (const name of weapons) {
      const weapon = session.spawn(codex.objectNames.getId(name));
      const total = shares.reduce((sum, id) => sum + weapon.getNumber(id), 0);
      expect(total, `'${name}' の配分の合計`).toBe(100);
    }
  });

  it('石斧は打ち砕き、槍は突き通す', () => {
    // 上位の武器2つは、同じ配分の目盛りの上で性格が分かれる（tools.yaml）。石斧は解体にも使えるが、
    // 槍は穂先が柄に固定されているので刃物にならない。
    const session = new WorldSession(codex);
    const axe = session.spawn(codex.objectNames.getId('stone_axe'));
    const spear = session.spawn(codex.objectNames.getId('spear'));

    expect(axe.getNumber(codex.propertyNames.getId('heavy_blow')), '斧だけが強打を持つ').toBeGreaterThan(0);
    expect(spear.getNumber(codex.propertyNames.getId('heavy_blow'))).toBe(0);
    expect(spear.getNumber(codex.propertyNames.getId('thrust')), '槍だけが刺突を持つ').toBeGreaterThan(0);
    expect(axe.getNumber(codex.propertyNames.getId('thrust'))).toBe(0);

    expect(axe.def.tags).toContain(codex.tagNames.getId('cutting_tool'));
    expect(spear.def.tags, '槍では解体できない').not.toContain(codex.tagNames.getId('cutting_tool'));
  });

  it('石へ石をドラッグすると、割られた側が尖った石になり、1時間が経つ', () => {
    const worldInstance = new WorldObject(
      0,
      codex.objects.get(codex.objectNames.getId('world')),
      new WorldSession(codex),
    );
    const worldView = new World(worldInstance, codex.propertyNames, codex.symbolNames);
    const session = new WorldSession(codex, worldView);

    const beach = session.spawn(codex.objectNames.getId('sandy_beach'));
    expect(beach.moveToSlot(worldInstance, codex.slotNames.getId('locations'))).toBeUndefined();

    const itemsSlotId = codex.slotNames.getId('items');
    const target = session.spawn(codex.objectNames.getId('stone'));
    const hammer = session.spawn(codex.objectNames.getId('stone'));
    expect(target.moveToSlot(beach, itemsSlotId)).toBeUndefined();

    const [combination] = target.findMatchingCombinations(hammer);
    expect(combination?.name, '石は石とのcombinationにマッチする').toBe('knap');

    expect(target.tryExecuteCombination(hammer, undefined, 'knap', session)).toBe(true);

    const view = new Location(beach, codex);
    expect(
      view.items.map((item) => item.def.name),
      '割られた側が尖った石へ置き換わる（槌は手元に残ったまま）',
    ).toEqual(['sharp_stone']);
    expect(hammer.parent, '打ち合わせた側は消えない').toBeUndefined();
    expect(worldView.hour, 'durationの60分が経つ').toBe(1);
    expect(worldView.minute).toBe(0);
  });
});
