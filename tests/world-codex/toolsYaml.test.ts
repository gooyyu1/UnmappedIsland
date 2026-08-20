import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { advanceCrafting, spawnInProgressObject } from '../../src/domain/crafting';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { Location } from '../../src/domain/views/Location';
import { World } from '../../src/domain/views/World';
import { inProgressObjectName, MATERIALS_SLOT } from '../../src/loader/inProgressObjects';
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

    const durability = sharpStone.tryGetProperty(codex.propertyNames.getId('durability'));
    expect(durability?.ratio, '打ち出したばかりの刃は減っていない').toBe(1);
    expect(durability?.getEffectiveValue(), '上限は種類によらず統一（DurabilitySystem.md 1節）').toBe(960);
  });

  it('武器は、一撃がどこへ入るかの重み配分を宣言する', () => {
    // 武器が持つのは威力ではなく配分（HuntingSystem.md 1.2節）。合計を100に揃えるのは、
    // 仕留めの重み（無防備さ）と並ぶ目盛りを武器ごとに変えないため。**書き忘れは0と区別が
    // 付かない**ので、ここで合計を数えて捕まえる。
    const session = new WorldSession(codex);
    const shares = ['heavy_blow', 'light_blow', 'thrust', 'whiff'].map((name) =>
      codex.propertyNames.getId(name),
    );
    // 製作中オブジェクトは完成品のタグを引き継ぐ（RecipeSystem.md 5節）ので weapon タグを持つが、
    // 相手として指名されない（ObjectDef.combinationsAccepting）ため配分も持たない。
    const weapons = codex
      .objectDefNamesWithTag('weapon')
      .filter((name) => !codex.isGenerated(codex.objects.get(codex.objectNames.getId(name))));

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

    const [combination] = target.combinationsWith(hammer, undefined);
    expect(combination?.name, '石は石とのcombinationにマッチする').toBe('knap');

    expect(target.tryExecuteCombination(hammer, undefined, 'knap')).toBe(true);

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

/**
 * 石斧のレシピ（tools.yaml）。**島で拾える物だけから斧へ届く**ことが、丸太＝筏（voyage.yaml）への
 * 入口を開ける（docs/world/Voyage.md 1節）。
 */
describe('石斧を作る', () => {
  let codex: WorldCodex;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
  });

  /** 岩場を1つ置いた世界。時間を進めるのでWorldを持つセッションを使う。 */
  function rockyField(): { session: WorldSession; field: WorldObject } {
    const worldInstance = new WorldObject(
      0,
      codex.objects.get(codex.objectNames.getId('world')),
      new WorldSession(codex),
    );
    const worldView = new World(worldInstance, codex.propertyNames, codex.symbolNames);
    const session = new WorldSession(codex, worldView);

    const field = session.spawn(codex.objectNames.getId('rocky_field'));
    expect(field.moveToSlot(worldInstance, codex.slotNames.getId('locations'))).toBeUndefined();
    return { session, field };
  }

  /** 石斧の作りかけを、その土地へ置く。 */
  function startAxe(session: WorldSession, field: WorldObject): WorldObject {
    return spawnInProgressObject(
      session,
      field,
      codex.objectNames.getId(inProgressObjectName('stone_axe', 'hafted')),
    );
  }

  it('太い枝・尖った石・紐から、2工程で石斧ができる', () => {
    const { session, field } = rockyField();
    const recipe = codex.objects.get(codex.objectNames.getId('stone_axe')).recipes[0];
    const materialsId = codex.slotNames.getId(MATERIALS_SLOT);
    const wip = startAxe(session, field);
    const put = (name: string) =>
      expect(session.spawn(codex.objectNames.getId(name)).moveToSlot(wip, materialsId)).toBeUndefined();

    put('thick_branch');
    expect(advanceCrafting(wip, recipe, materialsId, codex, session), '柄を削り出す').toBe(true);

    put('sharp_stone');
    put('cord');
    expect(advanceCrafting(wip, recipe, materialsId, codex, session), '刃を据えて縛る').toBe(true);

    expect(
      new Location(field, codex).items.map((item) => item.def.name),
      '作りかけが石斧そのものへ置き換わる',
    ).toEqual(['stone_axe']);
  });

  it('作りかけの石斧は、刃物として使えない', () => {
    // 製作中オブジェクトは完成品のタグ（cutting_tool等）を引き継ぐ（RecipeSystem.md 5節）。
    // 引き継ぎの目的は枠のacceptに当てはまることだけなので、道具としては働かない。
    const { session, field } = rockyField();
    const wip = startAxe(session, field);

    const stem = session.spawn(codex.objectNames.getId('banana_stem'));
    expect(stem.moveToSlot(field, codex.slotNames.getId('items'))).toBeUndefined();
    expect(wip.def.tags, 'タグの上では刃物').toContain(codex.tagNames.getId('cutting_tool'));

    expect(stem.combinationsWith(wip, undefined), '作りかけは相手にならない').toEqual([]);
    expect(stem.tryExecuteCombination(wip, undefined, 'strip'), '名指しでも実行できない').toBe(false);

    const sharpStone = session.spawn(codex.objectNames.getId('sharp_stone'));
    expect(
      stem.combinationsWith(sharpStone, undefined).map((combination) => combination.name),
      '出来上がった刃物でなら成立する',
    ).toEqual(['strip']);
  });
});
