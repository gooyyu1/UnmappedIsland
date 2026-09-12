import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { tryAdvanceCrafting, spawnInProgressObject } from '../../src/domain/crafting';
import type { RecipeDef } from '../../src/domain/RecipeDef';
import type { TypeMatchReading } from '../../src/domain/TypeMatchRule';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { Location } from '../../src/domain/wrappers/Location';
import { World } from '../../src/domain/wrappers/World';
import { inProgressObjectName } from '../../src/loader/inProgressObjects';
import { bundledCodex } from '../support/worldCodexFiles';
import { createBrightEnoughAgent } from '../support/illumination';

/**
 * tools.yamlの道具定義と、素材から道具を作るcombinationの自動テスト。石を石へドラッグして
 * 尖った石にする流れ（locations.yamlのstone.combinations.knap）を、実ファイルの定義だけで検証する。
 */
describe('tools.yamlの道具定義', () => {
  let codex: WorldCodex;

  beforeAll(() => {
    // stoneはlocations.yaml、成果物のsharp_stoneはtools.yamlと、ファイルをまたぐ参照があるため
    // ディレクトリ全体を一括ロードする。
    codex = bundledCodex();
  });

  /** その物を作るレシピ（1つだけ持つ物にしか使えない）。 */
  function recipeOf(name: string): RecipeDef {
    const recipes = codex.objects.get(codex.objectNames.getId(name)).recipesProducingThis;
    expect(recipes, `'${name}' のレシピは1つ`).toHaveLength(1);
    return recipes[0];
  }

  /** そのレシピが要求する物の名前（型を名指ししない要求は、当てはまる物の名前で並ぶ）。 */
  function materialsOf(recipe: RecipeDef): string[] {
    return [...codex.objects]
      .filter((def) => recipe.requires(def))
      .map((def) => def.name)
      .sort();
  }

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
    const sharpStone = session.createObject(codex.objectNames.getId('sharp_stone'));

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
    const weapons = codex.objectDefNamesWithTag(codex.tagNames.getId('weapon'));

    expect(weapons.length, '検査対象が無い（weaponタグが変わっていないか）').toBeGreaterThan(0);
    for (const name of weapons) {
      const weapon = session.createObject(codex.objectNames.getId(name));
      const total = shares.reduce((sum, id) => sum + (weapon.tryGetProperty(id)?.number ?? 0), 0);
      expect(total, `'${name}' の配分の合計`).toBe(100);
    }
  });

  it('石斧は打ち砕き、槍は突き通す', () => {
    // 上位の武器2つは、同じ配分の目盛りの上で性格が分かれる（tools.yaml）。石斧は断つ・割る側の
    // 刃物だが、槍は穂先が突き刺さる形なので刃物にならない。
    const session = new WorldSession(codex);
    const axe = session.createObject(codex.objectNames.getId('stone_axe'));
    const spear = session.createObject(codex.objectNames.getId('spear'));

    expect(
      axe.tryGetProperty(codex.propertyNames.getId('heavy_blow'))?.number ?? 0,
      '斧だけが強打を持つ',
    ).toBeGreaterThan(0);
    expect(spear.tryGetProperty(codex.propertyNames.getId('heavy_blow'))?.number ?? 0).toBe(0);
    expect(
      spear.tryGetProperty(codex.propertyNames.getId('thrust'))?.number ?? 0,
      '槍だけが刺突を持つ',
    ).toBeGreaterThan(0);
    expect(axe.tryGetProperty(codex.propertyNames.getId('thrust'))?.number ?? 0).toBe(0);

    expect(axe.def.tags).toContain(codex.tagNames.getId('cutting_tool'));
    expect(spear.def.tags, '槍は刃物ではない').not.toContain(codex.tagNames.getId('cutting_tool'));
    expect(
      axe.def.tags,
      '斧の頭部は柄に固定されているので、剥ぐ・掻く・削り出す側には回れない',
    ).not.toContain(codex.tagNames.getId('handheld_blade'));
  });

  it('突き銛は釣りの道具で、獣を突く武器ではない', () => {
    const harpoon = codex.objects.get(codex.objectNames.getId('fishing_harpoon'));

    expect(harpoon.tags).toContain(codex.tagNames.getId('tool'));
    // 釣りの手（voyage.yamlのspear_shoal・spear_sea）はこのタグで探す（docs/world/Voyage.md 3.9.4節）。
    expect(harpoon.tags).toContain(codex.tagNames.getId('fishing_tool'));
    expect(harpoon.tags, '獣を突く道具ではない').not.toContain(codex.tagNames.getId('weapon'));
  });

  it('槍の軸は長い棒で、斧を要求しない', () => {
    // 軸は若木を刃物で切って採る長い棒（docs/world/SurvivalItems.md 0節）。**材料が斧を要求するか
    // どうかだけで、狩りの入口が刃物の後ろに来るか斧の後ろに来るかが変わる**（同3節）ので、
    // 丸太を割る形へ戻ればここで落ちる。
    const spear = recipeOf('spear');

    expect(materialsOf(spear), '長い棒・尖った石・紐の3つ').toEqual(['cord', 'long_pole', 'sharp_stone']);
    expect(materialsOf(spear), '丸太も、それを割る斧も要らない').not.toContain('stone_axe');
  });

  it('突き銛の材料と工程は石斧と同じ（新しい素材を足していない）', () => {
    // **島の産物から筏・帆へ届く鎖の上に、素材を足さずに載る**（docs/world/Voyage.md 3.9.4節）。
    // 繊維で直に締める形にすれば柄付けの標準が2つ並び、長い棒から軸を削り出す形にすれば、槍と同じく
    // 若木と木材加工の腕の後ろへ回る。
    const harpoon = recipeOf('fishing_harpoon');
    const axe = recipeOf('stone_axe');

    expect(materialsOf(harpoon), '太い枝・尖った石・紐の3つ').toEqual([
      'cord',
      'sharp_stone',
      'thick_branch',
    ]);
    expect(materialsOf(harpoon), '石斧と同じ材料').toEqual(materialsOf(axe));
    expect(
      harpoon.steps.map((step) => step.durationMinutes),
      '柄をこしらえる・穂先を締め上げるの2工程も同じ',
    ).toEqual(axe.steps.map((step) => step.durationMinutes));
  });

  it('石へ石をドラッグすると、割られた側が尖った石になり、1時間が経つ', () => {
    const worldInstance = new WorldObject(
      0,
      codex.objects.get(codex.objectNames.getId('world')),
      new WorldSession(codex),
    );
    const worldView = new World(worldInstance, codex);
    const session = new WorldSession(codex, worldView);
    // 経過分は開始時刻（core.yamlのworld.hourの既定値）に依らず、組んだ時点からの差で見る。
    const startMinutes = worldView.totalMinutes;

    const beach = session.createObject(codex.objectNames.getId('sandy_beach'));
    expect(
      beach.moveToSlotOrRejection(worldInstance.getSlot(codex.slotNames.getId('locations'))),
    ).toBeUndefined();

    const itemsSlotId = codex.slotNames.getId('items');
    const target = session.createObject(codex.objectNames.getId('stone'));
    const hammer = session.createObject(codex.objectNames.getId('stone'));
    expect(target.moveToSlotOrRejection(beach.getSlot(itemsSlotId))).toBeUndefined();

    // 打ち欠くのは手元の作業なので、明るさが要る（IlluminationSystem.md 5節）。
    const knapper = createBrightEnoughAgent(session);
    const combination = target.combinationsWith(hammer, knapper).at(0);
    expect(combination?.name, '石は石とのcombinationにマッチする').toBe('knap');

    expect(
      target
        .combinationsWith(hammer, knapper)
        .find((c) => c.name === 'knap')
        ?.tryExecute() === true,
    ).toBe(true);

    const view = new Location(beach, codex);
    expect(
      view.items.map((item) => item.def.name),
      '割られた側が尖った石へ置き換わる（槌は手元に残ったまま）',
    ).toEqual(['sharp_stone']);
    expect(hammer.parent, '打ち合わせた側は消えない').toBeUndefined();
    expect(worldView.totalMinutes - startMinutes, 'durationの60分が経つ').toBe(60);
  });
});

/**
 * 石斧のレシピ（tools.yaml）。**島で拾える物だけから斧へ届く**ことが、丸太＝筏（voyage.yaml）への
 * 入口を開ける（docs/world/Voyage.md 1節）。
 */
describe('石斧を作る', () => {
  let codex: WorldCodex;

  beforeAll(() => {
    codex = bundledCodex();
  });

  /** 岩場を1つ置いた世界。時間を進めるのでWorldを持つセッションを使う。 */
  function rockyField(): { session: WorldSession; field: WorldObject } {
    const worldInstance = new WorldObject(
      0,
      codex.objects.get(codex.objectNames.getId('world')),
      new WorldSession(codex),
    );
    const worldView = new World(worldInstance, codex);
    const session = new WorldSession(codex, worldView);

    const field = session.createObject(codex.objectNames.getId('rocky_field'));
    expect(
      field.moveToSlotOrRejection(worldInstance.getSlot(codex.slotNames.getId('locations'))),
    ).toBeUndefined();
    return { session, field };
  }

  /** 石斧の作りかけを、その土地へ置く。 */
  function startAxe(field: WorldObject): WorldObject {
    return spawnInProgressObject(field, codex.objectNames.getId(inProgressObjectName('stone_axe', 'hafted')));
  }

  it('太い枝・尖った石・紐から、2工程で石斧ができる', () => {
    const { session, field } = rockyField();
    const materialsId = codex.vocabulary.engine.materialsSlotId;
    const wip = startAxe(field);
    // 工程を進めるには手元の明るさが要る（IlluminationSystem.md 5節）。
    const smith = createBrightEnoughAgent(session);
    const put = (name: string) =>
      expect(
        session.createObject(codex.objectNames.getId(name)).moveToSlotOrRejection(wip.getSlot(materialsId)),
      ).toBeUndefined();

    put('thick_branch');
    expect(tryAdvanceCrafting(wip, smith), '柄を削り出す').toBe(true);

    put('sharp_stone');
    put('cord');
    expect(tryAdvanceCrafting(wip, smith), '刃を据えて縛る').toBe(true);

    expect(
      new Location(field, codex).items.map((item) => item.def.name),
      '作りかけが石斧そのものへ置き換わる',
    ).toEqual(['stone_axe']);
  });

  it('作りかけの石斧は、刃物として使えない', () => {
    // 製作中オブジェクトが引き継ぐのは置き場所を言うタグだけ（RecipeSystem.md 5節）。刃物である
    // ことは完成品になって初めて名乗るので、重ねる操作の側に作りかけを弾く判定は要らない。
    const { session, field } = rockyField();
    const wip = startAxe(field);

    const stem = session.createObject(codex.objectNames.getId('banana_stem'));
    expect(stem.moveToSlotOrRejection(field.getSlot(codex.slotNames.getId('items')))).toBeUndefined();
    expect(wip.def.tags, 'タグの上でも刃物ではない').not.toContain(codex.tagNames.getId('cutting_tool'));
    expect(wip.def.tags, '掻き取りが探す握りの刃でもない').not.toContain(
      codex.tagNames.getId('handheld_blade'),
    );

    // 掻き取りは手元の明るさも要求する（IlluminationSystem.md 5節）。ここで見たいのは刃物かどうか
    // なので、明るさの側は満たしておく。
    const stripper = createBrightEnoughAgent(session);
    expect(stem.combinationsWith(wip, stripper), '作りかけは相手にならない').toEqual([]);
    expect(
      stem
        .combinationsWith(wip, stripper)
        .find((c) => c.name === 'strip')
        ?.tryExecute() === true,
      '名指しでも実行できない',
    ).toBe(false);

    const sharpStone = session.createObject(codex.objectNames.getId('sharp_stone'));
    expect(
      stem.combinationsWith(sharpStone, stripper).map((combination) => combination.name),
      '出来上がった刃物でなら成立する',
    ).toEqual(['strip']);
  });
});

/**
 * 刃物を要求する操作が、石斧で通るか通らないかを実ファイルの定義だけで見張る。線の引き方は
 * `src/assets/world-codex/tools.yaml` の sharp_stone——**刃を面へ沿わせて送り続ける操作は
 * handheld_blade、刃を一点・一線へ入れて済む操作は cutting_tool** で受ける。
 *
 * **表は片側だけでは効かない。** 通らない側だけを並べると、全部を handheld_blade へ寄せても緑のままで、
 * 石斧に何も残っていないことに気づけない。**表に載っていない宣言が無いことも下で数える**——載せ忘れた
 * 分だけ、分け方を誰も確かめないまま通ってしまうため。
 */

/**
 * 刃物のタグを名指ししている宣言と、それがどちら側かの表。`owner`は宣言している型、`step`は重ねる操作
 * またはレシピの名前。`handheldOnly`が真なら握りの刃でしか通らない。
 */
const BLADE_DECLARATIONS = [
  // 刃を面へ沿わせて送る操作。剥ぐ・掻き取る・削り出す。
  { owner: 'broadleaf_tree', step: 'strip_bark', recipe: false, handheldOnly: true },
  { owner: 'monkey_carcass', step: 'butcher', recipe: false, handheldOnly: true },
  { owner: 'wild_boar_carcass', step: 'butcher', recipe: false, handheldOnly: true },
  { owner: 'junglefowl_carcass', step: 'butcher', recipe: false, handheldOnly: true },
  { owner: 'small_bone', step: 'whittle', recipe: false, handheldOnly: true },
  { owner: 'banana_stem', step: 'strip', recipe: false, handheldOnly: true },
  { owner: 'coconut', step: 'husk', recipe: false, handheldOnly: true },
  { owner: 'coconut_half', step: 'scrape', recipe: false, handheldOnly: true },
  { owner: 'tanned_leather', step: 'tanned', recipe: true, handheldOnly: true },
  { owner: 'wood_carving', step: 'whittled', recipe: true, handheldOnly: true },
  // 刃を一点・一線へ入れれば済む操作。断つ・割る・こじる・穴を開ける・くり抜く。
  { owner: 'abaca', step: 'fell', recipe: false, handheldOnly: false },
  { owner: 'banana_plant', step: 'fell', recipe: false, handheldOnly: false },
  { owner: 'sapling', step: 'cut_pole', recipe: false, handheldOnly: false },
  { owner: 'palm_frond', step: 'split_and_weave', recipe: false, handheldOnly: false },
  { owner: 'green_coconut', step: 'bore', recipe: false, handheldOnly: false },
  { owner: 'drained_green_coconut', step: 'split', recipe: false, handheldOnly: false },
  { owner: 'husked_coconut', step: 'pry_open', recipe: false, handheldOnly: false },
  { owner: 'log_drum', step: 'hollowed', recipe: true, handheldOnly: false },
] as const;

const declarationsWhere = (recipe: boolean, handheldOnly: boolean) =>
  BLADE_DECLARATIONS.filter((row) => row.recipe === recipe && row.handheldOnly === handheldOnly).map(
    (row) => [row.owner, row.step] as const,
  );

describe('刃物を要求する操作が、石斧で通るかどうか', () => {
  let codex: WorldCodex;

  beforeAll(() => {
    codex = bundledCodex();
  });

  /**
   * その相手にその道具を当てたときに、**相手として名乗り出た**操作の名前。成立したものと、
   * 条件で断られたものの両方を数える——ここで見たいのは道具のタグが当たるかどうかで、明るさや
   * 天気で断られるかは別の話だから。
   */
  function triggeredCombinationNames(targetName: string, toolName: string): string[] {
    const session = new WorldSession(codex);
    const agent = createBrightEnoughAgent(session);
    const target = session.createObject(codex.objectNames.getId(targetName));
    const tool = session.createObject(codex.objectNames.getId(toolName));

    return [...target.combinationsWith(tool, agent), ...target.refusedCombinationsWith(tool, agent)].map(
      (combination) => combination.name,
    );
  }

  /** その名前のレシピが、その道具を要求のどれかに当てはめるか。 */
  function recipeAccepts(productName: string, recipeName: string, toolName: string): boolean {
    const recipes = codex.objects.get(codex.objectNames.getId(productName)).recipesProducingThis;
    const recipe = recipes.find((candidate) => candidate.name === recipeName);
    expect(recipe, `'${productName}' に '${recipeName}' のレシピがある`).toBeDefined();
    return recipe!.requires(codex.objects.get(codex.objectNames.getId(toolName)));
  }

  /**
   * 刃物のタグを名指ししている宣言を、定義から全部拾う（`型名.操作名`）。**軸から生成された変種は
   * 数えない**——塩漬けの死体も生のものと同じ宣言を写し取っているだけで、分け方を決める場所ではない。
   */
  function declaredBladeSteps(): string[] {
    const bladeTags = [codex.tagNames.getId('cutting_tool'), codex.tagNames.getId('handheld_blade')];
    const namesTagged = (reading: TypeMatchReading): boolean =>
      reading.kind === 'tag' && bladeTags.includes(reading.tagGlobalId);
    const found = new Set<string>();

    for (const def of codex.objects) {
      if (codex.isGenerated(def)) continue;
      for (const trigger of def.dragTriggers) {
        const reading = trigger.reading;
        if (reading.kind === 'drag' && namesTagged(reading.with))
          found.add(`${def.name}.${trigger.interaction.name}`);
      }
      for (const recipe of def.recipesProducingThis)
        for (const step of recipe.steps)
          for (const requirement of step.requirements)
            if (namesTagged(requirement.match.reading)) found.add(`${def.name}.${recipe.name}`);
    }
    return [...found].sort();
  }

  it.each(declarationsWhere(false, true))(
    '%s の %s は握りの刃でしか成立せず、石斧は相手にすらならない',
    (targetName, stepName) => {
      expect(triggeredCombinationNames(targetName, 'sharp_stone'), '尖った石は名乗り出る').toContain(
        stepName,
      );
      expect(
        triggeredCombinationNames(targetName, 'stone_axe'),
        '石斧では組み合わせが立たない（断られるのでもなく、候補に出ない）',
      ).not.toContain(stepName);
    },
  );

  it.each(declarationsWhere(false, false))(
    '%s の %s は、石斧でも尖った石でも成立する',
    (targetName, stepName) => {
      expect(triggeredCombinationNames(targetName, 'sharp_stone')).toContain(stepName);
      expect(triggeredCombinationNames(targetName, 'stone_axe')).toContain(stepName);
    },
  );

  it.each(declarationsWhere(true, true))(
    '%s の %s は、握りの刃を要求する（石斧では工程が埋まらない）',
    (productName, recipeName) => {
      expect(recipeAccepts(productName, recipeName, 'sharp_stone')).toBe(true);
      expect(recipeAccepts(productName, recipeName, 'stone_axe')).toBe(false);
    },
  );

  it.each(declarationsWhere(true, false))(
    '%s の %s は、石斧でも尖った石でも工程が埋まる',
    (productName, recipeName) => {
      expect(recipeAccepts(productName, recipeName, 'sharp_stone')).toBe(true);
      expect(recipeAccepts(productName, recipeName, 'stone_axe')).toBe(true);
    },
  );

  it('刃物のタグを名指しする宣言は、残らず表に載っている', () => {
    // 載せ忘れた宣言は、どちら側なのかを誰も確かめないまま通る。**定義の側を数え直して突き合わせる**
    // ので、新しく刃物を要求する宣言を書いたらここが落ちる（分け方は tools.yaml の sharp_stone）。
    expect(declaredBladeSteps()).toEqual(BLADE_DECLARATIONS.map((row) => `${row.owner}.${row.step}`).sort());
  });
});
