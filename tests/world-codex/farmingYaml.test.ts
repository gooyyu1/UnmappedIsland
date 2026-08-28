import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { World } from '../../src/domain/wrappers/World';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { fixedRng } from '../support/rng';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';
import { makeBrightEnoughForAnyAction } from '../support/illumination';

/**
 * farming.yamlの畑と囲いを、実ファイルの定義だけで検証する。
 *
 * 見たいのは**罠と同じ「留守番の設備」の形に乗っていること**（docs/engine/TrapSystem.md）で、
 * 撒く／入れる → 留守にする → 戻ると増えている、の一巡を通す。
 */
describe('farming.yamlの畑と囲い', () => {
  /**
   * 畑のpickは 空振り0・撒いた株ぶん、なので撒いてあれば引きによらず実る。ここで大きい値を使うのは
   * **撒いていない作物が出ないこと**を見るため——芋だけを撒いた畑でこの引きを与えても、
   * 重み0の葉物へは落ちない。
   */
  const ROLL = 0.9;

  let codex: WorldCodex;
  let session: WorldSession;
  let grassland: WorldObject;
  let player: WorldObject;
  let warinessId: number;
  let fodderId: number;
  let taroSownId: number;
  let growthRemainingId: number;
  let breedingRemainingId: number;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
    warinessId = codex.propertyNames.getId('wariness');
    fodderId = codex.propertyNames.getId('fodder');
    taroSownId = codex.propertyNames.getId('taro_sown');
    growthRemainingId = codex.propertyNames.getId('growth_remaining');
    breedingRemainingId = codex.propertyNames.getId('breeding_remaining');
  });

  /** 草原に立つプレイヤーから始める。rollがpickの引きと生成時のロールを決める。 */
  function open(roll = ROLL): void {
    const worldInstance = new WorldObject(
      0,
      codex.objects.get(codex.objectNames.getId('world')),
      new WorldSession(codex),
    );
    session = new WorldSession(codex, new World(worldInstance, codex), fixedRng(roll));
    grassland = spawnInto('grassland', worldInstance, 'locations');
    player = spawnInto(SAMPLE_CHARACTER, grassland, 'characters');
    makeBrightEnoughForAnyAction(player, codex);
  }

  function spawnInto(objectName: string, parent: WorldObject, slotName: string): WorldObject {
    const spawned = session.createObject(codex.objectNames.getId(objectName));
    expect(spawned.moveToSlotOrRejection(parent.getSlot(codex.slotNames.getId(slotName)))).toBeUndefined();
    return spawned;
  }

  function tick(count: number): void {
    for (let i = 0; i < count; i++) grassland.tick();
  }

  /** そのスロットに今並んでいる物の識別子。 */
  function contentsOf(owner: WorldObject, slotName: string): string[] {
    return (owner.tryGetSlot(codex.slotNames.getId(slotName))?.contents ?? []).map(
      (object) => object.def.name,
    );
  }

  /** 畑を1つ拓いた状態にする。 */
  function tillField(): WorldObject {
    return spawnInto('field', grassland, 'fixtures');
  }

  /** 畑へ1株撒く。 */
  function sow(field: WorldObject, seedName: string, interactionName: string): void {
    const seed = spawnInto(seedName, player, 'hand');
    expect(
      field
        .combinationsWith(seed, player)
        .find((combination) => combination.name === interactionName)
        ?.tryExecute() === true,
      `${interactionName} が実行できる`,
    ).toBe(true);
  }

  /** 実るまで進める。実らなければ失敗させる。 */
  function tickUntilHarvested(field: WorldObject, limit = 400): string[] {
    for (let i = 0; i < limit; i++) {
      tick(1);
      const crop = contentsOf(field, 'crop');
      if (crop.length > 0) return crop;
    }
    throw new Error('畑に何も実らなかった');
  }

  /** 囲いを1つ据えて、飼葉を芋で満たす。 */
  function buildPen(taroCount = 3): WorldObject {
    const pen = spawnInto('livestock_pen', grassland, 'fixtures');
    for (let i = 0; i < taroCount; i++) {
      const taro = spawnInto('taro', player, 'hand');
      expect(
        pen
          .combinationsWith(taro, player)
          .find((combination) => combination.name === 'feed')
          ?.tryExecute() === true,
        '飼葉をやれる',
      ).toBe(true);
    }
    return pen;
  }

  /**
   * 落ち着いたヤケイを1羽用意する。**野生の個体は警戒した状態で現れる**（animals.yamlのwariness）ので、
   * 引き切るまで待つ——生け捕りにして待つのが、囲いへ入れる唯一の入口になる
   * （docs/engine/VitalsSystem.md 7節・TrapSystem.md 5.2節）。
   */
  function calmJunglefowl(): WorldObject {
    const fowl = spawnInto('junglefowl', grassland, 'items');
    tick(40);
    expect(fowl.tryGetProperty(warinessId)!.getEffectiveValue(), '警戒が引き切っている').toBe(0);
    return fowl;
  }

  /** 囲いの中のヤケイの数。 */
  function pennedCount(pen: WorldObject): number {
    return contentsOf(pen, 'livestock').length;
  }

  it('種を撒くまで、畑は何も実らせない', () => {
    // 罠の空振り（miss_weight）にあたるものを畑は持たず、撒いていない回は先頭の重み0の候補で
    // 拾われる（全候補0なら先頭、GameElementDefinition.md 10節）。
    open();
    const field = tillField();

    tick(400);
    expect(contentsOf(field, 'crop'), '撒いていない畑は空のまま').toEqual([]);
  });

  it('撒いた芋は、留守の間に育って畑に実る', () => {
    // 罠と同じ形の周期タイマー（growth_remaining）が尽きるたびに1株ぶんが実る。
    open();
    const field = tillField();
    sow(field, 'taro', 'sow_taro');
    expect(field.tryGetProperty(taroSownId)!.getEffectiveValue(), '1株撒かれた').toBe(1);

    expect(tickUntilHarvested(field), '種芋1つから親芋と子芋が採れる').toEqual(['taro', 'taro', 'taro']);
    expect(field.tryGetProperty(taroSownId)!.getEffectiveValue(), '撒いた株は消費される').toBe(0);
  });

  it('撒いた株のぶんだけで止まる', () => {
    // **畑は無限には実らない。** 撒いた株が重みそのものなので、尽きれば重み0の先頭へ落ちる
    // ——罠が「回収するまで次は掛からない」で止まるのと同じく、放っておくだけでは増えない。
    open();
    const field = tillField();
    sow(field, 'taro', 'sow_taro');
    tickUntilHarvested(field);

    tick(400);
    expect(contentsOf(field, 'crop'), '2株目は実らない').toEqual(['taro', 'taro', 'taro']);
  });

  it('撒いていない作物は実らない', () => {
    // 罠の側が1行も書き換わらずに「岩礁海岸にヤケイは掛からない」が決まるのと同じ
    // （TrapSystem.md 3節）。撒いていない作物は重みが0になり、その候補ごと抽選から外れる。
    open();
    const field = tillField();
    sow(field, 'taro', 'sow_taro');

    const crop = tickUntilHarvested(field);
    expect(crop).not.toContain('water_spinach');
  });

  it('葉物も同じ畑で育つ', () => {
    open();
    const field = tillField();
    sow(field, 'water_spinach', 'sow_water_spinach');

    expect(tickUntilHarvested(field)).toEqual(['water_spinach', 'water_spinach', 'water_spinach']);
  });

  it('畑は太い枝1本から拓ける', () => {
    // 掘削具はまだ無いので、掘り棒にする太い枝1本だけを要求している（farming.yaml）。
    open();
    const def = codex.objects.get(codex.objectNames.getId('field'));
    const [recipe] = def.recipesProducingThis;
    const [step] = recipe!.steps;

    expect(step!.requirements).toHaveLength(1);
    expect(step!.requirements[0].requires(codex.objects.get(codex.objectNames.getId('thick_branch')))).toBe(
      true,
    );
  });

  it('荒ぶる獣は囲いへ入れられない', () => {
    // 警戒している間はどの持ち主にも付けない（resists、GameElementDefinition.md 7.13節）。
    // **生け捕りにして落ち着くのを待つ**のが、囲いへ入れる唯一の入口になる。
    open();
    const pen = buildPen();
    const wild = spawnInto('junglefowl', grassland, 'items');

    expect(wild.tryGetProperty(warinessId)!.getEffectiveValue()).toBeGreaterThan(0);
    expect(
      wild.moveToSlotOrRejection(pen.getSlot(codex.slotNames.getId('livestock'))),
      '荒ぶる個体は囲いが受け取らない',
    ).toBeDefined();
  });

  it('囲いに入れたヤケイは、留守の間に増える', () => {
    // **増えるのは獣自身の仕事**（animals.yamlのbreeding_remaining）。囲いは枠と飼葉を持つだけで、
    // 中に何が居るかを知らない。
    open();
    const pen = buildPen();
    const fowl = calmJunglefowl();
    expect(fowl.moveToSlotOrRejection(pen.getSlot(codex.slotNames.getId('livestock')))).toBeUndefined();

    for (let i = 0; i < 600 && pennedCount(pen) < 2; i++) tick(1);
    expect(contentsOf(pen, 'livestock'), '1羽増えている').toEqual(['junglefowl', 'junglefowl']);
  });

  it('生まれた仔は囲いに留まる', () => {
    // 生まれた個体は野生と同じ警戒を持つので、そのままでは付いた直後に土地までこぼれ出る
    // （7.13節）。囲いが罠と同じ拘束のmodifyを持つことだけが、これを留めている。
    open();
    const pen = buildPen();
    const fowl = calmJunglefowl();
    fowl.moveToSlotOrRejection(pen.getSlot(codex.slotNames.getId('livestock')));

    for (let i = 0; i < 600 && pennedCount(pen) < 2; i++) tick(1);
    const born = pen.tryGetSlot(codex.slotNames.getId('livestock'))!.contents.find((o) => o !== fowl)!;
    expect(born.parent, '仔は囲いの中に居る').toBe(pen);
    expect(contentsOf(grassland, 'items'), '地面へこぼれていない').toEqual([]);
  });

  it('飼葉が無ければ増えない', () => {
    // **これが飼育の代償**で、罠の餌とまったく同じ性質（TrapSystem.md 4節）——自分が食べられる
    // 食料を先に賭ける。
    open();
    const pen = buildPen(0);
    const fowl = calmJunglefowl();
    fowl.moveToSlotOrRejection(pen.getSlot(codex.slotNames.getId('livestock')));

    tick(600);
    expect(pennedCount(pen), '飼葉の無い囲いでは増えない').toBe(1);
  });

  it('囲いの外では、増えるまでの時間が進まない', () => {
    // 囲いの枠に居る間だけ数える（`in_slot: livestock`）。地面に立っている個体も、罠に掛かって
    // いる個体も進まない——地面に置いた罠だけが動くのと同じ形（TrapSystem.md 1節）。
    open();
    const fowl = calmJunglefowl();
    const onGround = fowl.tryGetProperty(breedingRemainingId)!.getEffectiveValue();

    tick(50);
    expect(fowl.tryGetProperty(breedingRemainingId)!.getEffectiveValue()).toBe(onGround);
  });

  it('飼葉は頭数のぶんだけ速く減る', () => {
    // 囲いの側は中身を数えられない（条件は存在判定だけ、14.3節）。**食べるのは食べる当人**なので、
    // 頭数が効くことが、囲いに1行も書かずに出る。
    open();
    const pen = buildPen();
    const livestock = pen.getSlot(codex.slotNames.getId('livestock'));
    const first = calmJunglefowl();
    first.moveToSlotOrRejection(livestock);

    const beforeOne = pen.tryGetProperty(fodderId)!.getEffectiveValue();
    tick(1);
    const oneRate = beforeOne - pen.tryGetProperty(fodderId)!.getEffectiveValue();
    expect(oneRate, '1羽でも減る').toBeGreaterThan(0);

    calmJunglefowl().moveToSlotOrRejection(livestock);
    const beforeTwo = pen.tryGetProperty(fodderId)!.getEffectiveValue();
    tick(1);
    const twoRate = beforeTwo - pen.tryGetProperty(fodderId)!.getEffectiveValue();

    expect(twoRate, '2羽なら2倍').toBeCloseTo(oneRate * 2);
  });

  it('囲いは丸太と縄から作れる', () => {
    // 罠の檻（TrapSystem.md 1.2節）と同じ材料。**生かして扱う設備は常に高くつく**。
    open();
    const def = codex.objects.get(codex.objectNames.getId('livestock_pen'));
    const [recipe] = def.recipesProducingThis;
    const [step] = recipe!.steps;

    expect(step!.requirements).toHaveLength(2);
    expect(step!.requirements[0].requires(codex.objects.get(codex.objectNames.getId('log')))).toBe(true);
    expect(step!.requirements[1].requires(codex.objects.get(codex.objectNames.getId('rope')))).toBe(true);
  });

  it('据えた畑と囲いは、持ち歩けない', () => {
    // どちらも設置物（fixture）で、itemタグを持たない——手持ちの枠が受け取らないので、
    // 罠のように仕掛け直すことはできない（TrapSystem.md 1節の落とし穴と同じ）。
    open();
    const hand = player.getSlot(codex.slotNames.getId('hand'));

    expect(tillField().moveToSlotOrRejection(hand), '畑は手に取れない').toBeDefined();
    expect(spawnInto('livestock_pen', grassland, 'fixtures').moveToSlotOrRejection(hand)).toBeDefined();
  });

  it('畑のタイマーは、実るまで止まらない', () => {
    // 罠は掛かった瞬間に止まる（TrapSystem.md 6節）が、畑は撒いてあるかどうかによらず回り続ける
    // ——止める意味が無い（撒いていなければ重み0の先頭へ落ちるだけ）ので、条件を1つも持たない。
    open();
    const field = tillField();
    const before = field.tryGetProperty(growthRemainingId)!.getEffectiveValue();

    tick(1);
    expect(field.tryGetProperty(growthRemainingId)!.getEffectiveValue()).toBeLessThan(before);
  });
});
