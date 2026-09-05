import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { World } from '../../src/domain/wrappers/World';
import { fixedRng } from '../support/rng';
import { bundledCodex, SAMPLE_CHARACTER } from '../support/worldCodexFiles';
import { makeBrightEnoughForAnyAction } from '../support/illumination';

/**
 * farming.yamlの畑と囲いを、実ファイルの定義だけで検証する。
 *
 * 見たいのは**罠と同じ「留守番の設備」の形に乗っていること**（docs/engine/TrapSystem.md）で、
 * 撒く／入れる → 留守にする → 戻ると増えている、の一巡を通す。
 *
 * 囲いは**罠の檻と同じ1つの型**（同1.2節）なので、空けておけば掛かり、埋めておけば増える。
 * 掛かった個体をそのまま飼えること——**移し替えが要らないこと**——がこの型の要（同5.2節）。
 */
describe('farming.yamlの畑と囲い', () => {
  /**
   * 畑のpickは 空振り0・撒いた株ぶん、なので撒いてあれば引きによらず実る。ここで大きい値を使うのは
   * **撒いていない作物が出ないこと**を見るため——芋だけを撒いた畑でこの引きを与えても、
   * 重み0の葉物へは落ちない。
   *
   * 囲いにとってもこれは**掛かる引き**にあたる。外側は 空振り40・寄った10（飼葉があれば15と35）で
   * 合計50なので0.9は寄った側へ落ち、内側は据えた土地が並べた候補で決まる——草原の
   * 空振り8・ヤケイ10 ならヤケイ、森の 空振り8・イノシシ2 と密林の 空振り8・ヤケイ8・イノシシ2 なら
   * どちらもイノシシに当たる（末尾の候補なので、土地が宣言していなければ引きは空振りへ落ちる）。
   * **囲いを空のまま進めると掛かる**ので、飼育を見る試験は先に中を埋めてから時間を進める。
   */
  const ROLL = 0.9;

  let codex: WorldCodex;
  let session: WorldSession;
  /** 囲いを据える土地。据えた土地が掛かる相手を決める（TrapSystem.md 3節）ので、試験ごとに選ぶ。 */
  let land: WorldObject;
  let player: WorldObject;
  let warinessId: number;
  let vulnerabilityId: number;
  let bloodId: number;
  let hydrationId: number;
  let fodderId: number;
  let drinkingWaterId: number;
  let fillId: number;
  let taroSownId: number;
  let growthRemainingId: number;
  let breedingRemainingId: number;
  let catchRemainingId: number;
  let missWeightId: number;
  let herbivoreWeightId: number;

  beforeAll(() => {
    codex = bundledCodex();
    warinessId = codex.propertyNames.getId('wariness');
    vulnerabilityId = codex.propertyNames.getId('vulnerability');
    bloodId = codex.propertyNames.getId('blood');
    hydrationId = codex.propertyNames.getId('hydration');
    fodderId = codex.propertyNames.getId('fodder');
    drinkingWaterId = codex.propertyNames.getId('drinking_water');
    fillId = codex.propertyNames.getId('fill');
    taroSownId = codex.propertyNames.getId('taro_sown');
    growthRemainingId = codex.propertyNames.getId('growth_remaining');
    breedingRemainingId = codex.propertyNames.getId('breeding_remaining');
    catchRemainingId = codex.propertyNames.getId('catch_remaining');
    missWeightId = codex.propertyNames.getId('miss_weight');
    herbivoreWeightId = codex.propertyNames.getId('herbivore_weight');
  });

  /**
   * その土地に立つプレイヤーから始める。rollがpickの引きと生成時のロールを決める。
   *
   * 土地を選べるのは、**囲いに掛かる相手を決めるのが土地だから**（TrapSystem.md 3節）。
   * 草原はヤケイだけを宣言し、森と密林はイノシシも宣言する。
   */
  function open(roll = ROLL, locationName = 'grassland'): void {
    const worldInstance = new WorldObject(
      0,
      codex.objects.get(codex.objectNames.getId('world')),
      new WorldSession(codex),
    );
    session = new WorldSession(codex, new World(worldInstance, codex), fixedRng(roll));
    land = spawnInto(locationName, worldInstance, 'locations');
    player = spawnInto(SAMPLE_CHARACTER, land, 'characters');
    makeBrightEnoughForAnyAction(player, codex);
  }

  function spawnInto(objectName: string, parent: WorldObject, slotName: string): WorldObject {
    const spawned = session.createObject(codex.objectNames.getId(objectName));
    expect(spawned.moveToSlotOrRejection(parent.getSlot(codex.slotNames.getId(slotName)))).toBeUndefined();
    return spawned;
  }

  function tick(count: number): void {
    for (let i = 0; i < count; i++) land.tick();
  }

  /** そのスロットに今並んでいる物の識別子。 */
  function contentsOf(owner: WorldObject, slotName: string): string[] {
    return (owner.tryGetSlot(codex.slotNames.getId(slotName))?.contents ?? []).map(
      (object) => object.def.name,
    );
  }

  /** 畑を1つ拓いた状態にする。 */
  function tillField(): WorldObject {
    return spawnInto('field', land, 'fixtures');
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

  /** 囲いへ芋を与える。1つで飼葉が12増える（farming.yamlのfodderは上限96）。 */
  function feed(pen: WorldObject, taroCount: number): void {
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
  }

  /** 囲いを1つ据えて、飼葉を芋で満たす。 */
  function buildPen(taroCount = 3): WorldObject {
    const pen = spawnInto('pen', land, 'fixtures');
    feed(pen, taroCount);
    return pen;
  }

  /**
   * 水入りの甕を1つ空けて、囲いの飲み水にする（飼葉と同じドラッグ型の操作）。返すのは注いだ後の器で、
   * 空になれば中身の軸が落ちて素の甕へ戻る（liquid_containers.yaml）。
   */
  function pourWater(pen: WorldObject, milliliters = 4000): WorldObject {
    const jar = spawnInto('jar__content_water_liquid', player, 'hand');
    jar.tryGetProperty(fillId)!.setNumber(milliliters);
    expect(
      pen
        .combinationsWith(jar, player)
        .find((combination) => combination.name === 'water')
        ?.tryExecute() === true,
      '水をやれる',
    ).toBe(true);
    return jar;
  }

  /**
   * 落ち着いたヤケイを1羽用意する。**野生の個体は警戒した状態で現れる**（animals.yamlのwariness）ので、
   * 引き切るまで待つ——手で囲いへ入れるなら、生け捕りにして待つのが唯一の入口になる
   * （docs/engine/VitalsSystem.md 7節・TrapSystem.md 5.2節）。
   *
   * **囲いを据える前に呼ぶこと。** 空の囲いは罠なので、待っている40 tickのあいだに掛かってしまう。
   */
  function calmJunglefowl(): WorldObject {
    const fowl = spawnInto('junglefowl', land, 'items');
    tick(40);
    expect(fowl.tryGetProperty(warinessId)!.getEffectiveValue(), '警戒が引き切っている').toBe(0);
    return fowl;
  }

  /** 落ち着いたヤケイを1羽入れた囲いを用意する。飼葉は満たしておく。 */
  function penWithCalmFowl(): { pen: WorldObject; fowl: WorldObject } {
    const fowl = calmJunglefowl();
    const pen = buildPen();
    expect(fowl.moveToSlotOrRejection(pen.getSlot(codex.slotNames.getId('catch')))).toBeUndefined();
    return { pen, fowl };
  }

  /** 掛かるまで進める。掛からなければ失敗させる（周期16 tickなので余裕を持って回す）。 */
  function tickUntilCaught(pen: WorldObject, limit = 40): WorldObject {
    for (let i = 0; i < limit; i++) {
      tick(1);
      const first = pen.tryGetSlot(codex.slotNames.getId('catch'))!.contents.at(0);
      if (first !== undefined) return first;
    }
    throw new Error('囲いに何も掛からなかった');
  }

  /** その動物に刺さっている怪我の識別子。 */
  function injuriesOf(animal: WorldObject): string[] {
    const slot = animal.tryGetSlot(codex.slotNames.getId('injuries'));
    return slot === undefined ? [] : slot.contents.map((object) => object.def.name);
  }

  /** 囲いの中のヤケイの数。 */
  function pennedCount(pen: WorldObject): number {
    return contentsOf(pen, 'catch').length;
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
    const wild = spawnInto('junglefowl', land, 'items');

    expect(wild.tryGetProperty(warinessId)!.getEffectiveValue()).toBeGreaterThan(0);
    expect(
      wild.moveToSlotOrRejection(pen.getSlot(codex.slotNames.getId('catch'))),
      '荒ぶる個体は囲いが受け取らない',
    ).toBeDefined();
  });

  it('囲いに入れたヤケイは、留守の間に増える', () => {
    // **増えるのは獣自身の仕事**（animals.yamlのbreeding_remaining）。囲いは枠と飼葉を持つだけで、
    // 中に何が居るかを知らない。
    open();
    const { pen } = penWithCalmFowl();
    // **水をやらなければ、増える前に渇いて死ぬ**（下の「水をやらなければ〜」）。飼葉が尽きても
    // 増えなくなるだけだが、水が尽きれば失う——留守番の設備を回すのに見に戻る理由がこれ。
    pourWater(pen);

    for (let i = 0; i < 600 && pennedCount(pen) < 2; i++) tick(1);
    expect(contentsOf(pen, 'catch'), '1羽増えている').toEqual(['junglefowl', 'junglefowl']);
  });

  it('生まれた仔は囲いに留まる', () => {
    // 生まれた個体は野生と同じ警戒を持つので、そのままでは付いた直後に土地までこぼれ出る
    // （7.13節）。囲いが罠と同じ拘束のmodifyを持つことだけが、これを留めている。
    open();
    const { pen, fowl } = penWithCalmFowl();
    // 空いた器は片付ける——**人のほうが先に渇いて倒れる**（600 tickはキャラクタの水分より長い）ので、
    // 手持ちのまま残すと地面へこぼれ、この試験が見たい「仔がこぼれていないこと」と混ざる。
    pourWater(pen).destroy();

    for (let i = 0; i < 600 && pennedCount(pen) < 2; i++) tick(1);
    const born = pen.tryGetSlot(codex.slotNames.getId('catch'))!.contents.find((o) => o !== fowl)!;
    expect(born.parent, '仔は囲いの中に居る').toBe(pen);
    expect(contentsOf(land, 'items'), '地面へこぼれていない').toEqual([]);
  });

  it('飼葉が無ければ増えない', () => {
    // **これが飼育の代償**で、罠の餌とまったく同じ性質（TrapSystem.md 4節）——自分が食べられる
    // 食料を先に賭ける。
    open();
    const fowl = calmJunglefowl();
    const pen = buildPen(0);
    fowl.moveToSlotOrRejection(pen.getSlot(codex.slotNames.getId('catch')));

    tick(600);
    expect(pennedCount(pen), '飼葉の無い囲いでは増えない').toBe(1);
  });

  it('囲いの外では、増えるまでの時間が進まない', () => {
    // 閉じ込められている間だけ数える（`in_slot: catch`）。地面に立っている個体は進まない
    // ——地面に置いた罠だけが動くのと同じ形（TrapSystem.md 1節）。くくり罠に掛かった個体が
    // 進まないのは飼葉のほうが止めている（罠は飼葉を持たない、animals.yaml）。
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
    const first = calmJunglefowl();
    const pen = buildPen();
    const penned = pen.getSlot(codex.slotNames.getId('catch'));
    first.moveToSlotOrRejection(penned);

    const beforeOne = pen.tryGetProperty(fodderId)!.getEffectiveValue();
    tick(1);
    const oneRate = beforeOne - pen.tryGetProperty(fodderId)!.getEffectiveValue();
    expect(oneRate, '1羽でも減る').toBeGreaterThan(0);

    calmJunglefowl().moveToSlotOrRejection(penned);
    const beforeTwo = pen.tryGetProperty(fodderId)!.getEffectiveValue();
    tick(1);
    const twoRate = beforeTwo - pen.tryGetProperty(fodderId)!.getEffectiveValue();

    expect(twoRate, '2羽なら2倍').toBeCloseTo(oneRate * 2);
  });

  it('水をやらなければ、囲いの獣は3日半で渇いて死ぬ', () => {
    // **これが檻を放置した罰**（TrapSystem.md 5.4節）。丸太を組んだ檻に耐久は無く、くくり罠のように
    // もがかれて壊れることもないので、渇きだけがその空白を埋める。
    //
    // **死体は残らない。** 死体になる唯一の道はblood（animals.yamlの各動物のon_min）で、渇きで
    // 失うのは個体そのもの——掛けたまま忘れれば、生かして獲った意味が消える。
    open();
    const { pen, fowl } = penWithCalmFowl();
    expect(fowl.tryGetProperty(hydrationId)!.number, '満たされた状態で捕らえる').toBe(336);

    tick(335);
    expect(pennedCount(pen), '3日半までは生きている').toBe(1);

    tick(1);
    expect(contentsOf(pen, 'catch'), '渇いて消える（死体も残らない）').toEqual([]);
    expect(contentsOf(land, 'items'), '地面にも何も落ちない').toEqual([]);
  });

  it('水をやってあれば、囲いの獣は渇かない', () => {
    // **飲むのは飲む当人**（animals.yamlのbeast）。囲いは中身を数えられない（14.3節）ので、
    // 飼葉とまったく同じ形で、飲み水の減りにも頭数がそのまま効く。
    open();
    const { pen, fowl } = penWithCalmFowl();
    pourWater(pen);

    tick(100);

    expect(fowl.tryGetProperty(hydrationId)!.number, '飲んだぶんだけ満たされたまま').toBe(336);
    expect(pen.tryGetProperty(drinkingWaterId)!.number, '1 tickあたり25mL減る').toBe(4000 - 25 * 100);
  });

  it('飲み水は頭数のぶんだけ速く減る', () => {
    // 飼葉と同じ理由（囲いの側は1行も書いていない）。**2羽居れば2倍の速さで尽きる。**
    open();
    const { pen } = penWithCalmFowl();
    pourWater(pen);

    const beforeOne = pen.tryGetProperty(drinkingWaterId)!.number;
    tick(1);
    const oneRate = beforeOne - pen.tryGetProperty(drinkingWaterId)!.number;
    expect(oneRate, '1羽でも減る').toBeGreaterThan(0);

    calmJunglefowl().moveToSlotOrRejection(pen.getSlot(codex.slotNames.getId('catch')));
    const beforeTwo = pen.tryGetProperty(drinkingWaterId)!.number;
    tick(1);

    expect(beforeTwo - pen.tryGetProperty(drinkingWaterId)!.number, '2羽なら2倍').toBeCloseTo(oneRate * 2);
  });

  it('満ちた囲いは、重ねた飼葉と水を断る理由を名乗る', () => {
    // 上限に達したことは `conditions` にも書いてある（pen_fed・pen_watered）ので、落ちるその瞬間に
    // 容量と条件が同時に落ちる。**容量を候補選びの足切りにすると候補ごと消えて理由が届かない**
    // ——断る理由を宣言しているものは落とし先として残す（14.6節・CardInteraction.md 2.1節）。
    //
    // **水を先に注ぐ。** 口の開いた甕は持っている間に蒸発する（liquid_containers.yaml）ので、
    // 芋を8つ与える40分を挟むと甕1杯では満たなくなる。
    open();
    const pen = spawnInto('pen', land, 'fixtures');
    pourWater(pen, 4000);
    feed(pen, 8);
    expect(pen.tryGetProperty(fodderId)!.number, '芋12を8つで上限まで').toBe(96);
    expect(pen.tryGetProperty(drinkingWaterId)!.number, '甕1杯で上限まで').toBe(4000);

    const taro = spawnInto('taro', player, 'hand');
    expect(pen.combinationsWith(taro, player), '成立する組み合わせは無い').toEqual([]);
    expect(
      pen
        .refusedCombinationsWith(taro, player)
        .map((combination) => combination.unmetRequirement()?.reasonName),
      '飼葉を断る理由まで辿り着ける',
    ).toEqual(['pen_fed']);

    const jar = spawnInto('jar__content_water_liquid', player, 'hand');
    jar.tryGetProperty(fillId)!.setNumber(4000);
    expect(pen.combinationsWith(jar, player), '成立する組み合わせは無い').toEqual([]);
    expect(
      pen
        .refusedCombinationsWith(jar, player)
        .map((combination) => combination.unmetRequirement()?.reasonName),
      '水を断る理由まで辿り着ける',
    ).toEqual(['pen_watered']);
  });

  it('水をやった器は、空になって手元に残る', () => {
    // 飼葉は器ごと消える（食べ物そのものが餌になる）が、水は容器の変種として在る
    // （liquid_containers.yaml）ので、注いだぶんfillが減り、空になれば素の甕へ戻る。
    // **入りきらない分は器に残る**ので、水は1mLも捨てない。
    open();
    const pen = spawnInto('pen', land, 'fixtures');
    const jar = pourWater(pen, 4000);

    expect(jar.def.name, '空の甕へ戻っている').toBe('jar');
    expect(pen.tryGetProperty(drinkingWaterId)!.number, '全部入った').toBe(4000);

    const second = spawnInto('jar__content_water_liquid', player, 'hand');
    second.tryGetProperty(fillId)!.setNumber(4000);
    expect(
      pen.combinationsWith(second, player).map((combination) => combination.name),
      '満ちた囲いへは注げない',
    ).not.toContain('water');
  });

  it('空の囲いは罠として働き、掛かった獣に打ち身が刺さる', () => {
    // **檻と家畜の囲いは1つの型**（TrapSystem.md 1.2節）。空いている間は大型を生かして捕らえる罠で、
    // spawnの配列が順に生むので獲物を生んでからその中へ怪我を生む（into: child、同5.3節）。
    open();
    const pen = buildPen();

    const prey = tickUntilCaught(pen);
    expect(prey.def.name).toBe('junglefowl');
    expect(injuriesOf(prey), '檻の打ち身が刺さる').toEqual(['bruise']);
    expect(contentsOf(land, 'items'), 'レーンに出ない——獲物は囲いの中に居る').toEqual([]);
  });

  it('檻の打ち身は血を奪わないので、掛かった獣は死なない', () => {
    // **生かす罠の性格は、bleedingを書かなかったことでできている**（TrapSystem.md 5.2節）。
    // くくり罠の傷なら80mLのヤケイは血を失うが、打ち身では1mLも減らない。
    open();
    const prey = tickUntilCaught(buildPen());
    const blood = prey.tryGetProperty(bloodId)!.getEffectiveValue();

    tick(20);
    expect(prey.def.name, '死体になっていない').toBe('junglefowl');
    expect(prey.tryGetProperty(bloodId)!.getEffectiveValue(), '血は減らない').toBeGreaterThanOrEqual(blood);
  });

  it('森と密林に据えた檻には、イノシシが掛かる', () => {
    // **大型が掛かるかどうかは、土地が`wild_boar_catch`を宣言しているかだけで決まる**
    // （TrapSystem.md 3節）。檻の側はイノシシを候補に並べてあるが（farming.yaml）、宣言の無い
    // 草原では重み0で候補ごと落ちる——上の試験でヤケイしか掛からないのがそれ。
    for (const locationName of ['forest', 'jungle']) {
      open(ROLL, locationName);
      const prey = tickUntilCaught(buildPen());

      expect(prey.def.name, `${locationName}はイノシシを宣言している`).toBe('wild_boar');
      expect(injuriesOf(prey), '檻の打ち身が刺さる').toEqual(['bruise']);
      expect(contentsOf(land, 'items'), 'レーンに出ない——獲物は檻の中に居る').toEqual([]);
    }
  });

  it('檻に掛かったイノシシは、血を失わずに生きたまま残る', () => {
    // **檻が体格によらず生かせるのは、bruiseがbleedingを書いていないこと1つ**
    // （TrapSystem.md 5.2節）。くくり罠の傷は体格との比で意味が変わる（同5.1節）が、比を持たない
    // 打ち身は60kgのイノシシからも1kgのヤケイからも1mLも奪わない。
    open(ROLL, 'forest');
    const prey = tickUntilCaught(buildPen());
    const blood = prey.tryGetProperty(bloodId)!.getEffectiveValue();

    tick(40);
    expect(prey.def.name, '死体になっていない').toBe('wild_boar');
    expect(prey.tryGetProperty(bloodId)!.getEffectiveValue(), '血は減らない').toBeGreaterThanOrEqual(blood);
    expect(injuriesOf(prey), '傷は残ったまま').toEqual(['bruise']);
    expect(prey.tryGetProperty(warinessId)!.getEffectiveValue(), '牙を持つ相手でも暴れない').toBe(0);
  });

  it('掛かった獣は拘束され、囲いは罠であることをやめる', () => {
    // 拘束は罠と同じ1ブロック（TrapSystem.md 5節）。タイマーが止まるのは「中に獲物が居ないこと」を
    // 問う条件1つ（同6節）で、**これが檻を囲いに変えている**。
    open();
    const pen = buildPen();
    const prey = tickUntilCaught(pen);

    expect(prey.tryGetProperty(warinessId)!.getEffectiveValue(), '中では暴れない').toBe(0);
    expect(prey.tryGetProperty(vulnerabilityId)!.getEffectiveValue(), '締めやすくなる').toBeGreaterThan(100);

    const stopped = pen.tryGetProperty(catchRemainingId)!.getEffectiveValue();
    tick(20);
    expect(pen.tryGetProperty(catchRemainingId)!.getEffectiveValue(), '2頭目は掛からない').toBe(stopped);
    expect(pennedCount(pen)).toBe(1);
  });

  it('手で入れた家畜も、同じ条件で罠を止める', () => {
    // 掛かって入ったか手で入れたかを、囲いは区別しない——問うているのは中に居るかだけ。
    open();
    const { pen } = penWithCalmFowl();
    const stopped = pen.tryGetProperty(catchRemainingId)!.getEffectiveValue();

    tick(20);
    expect(pen.tryGetProperty(catchRemainingId)!.getEffectiveValue()).toBe(stopped);
    expect(contentsOf(pen, 'catch'), '獣が掛かって増えたりしない').toEqual(['junglefowl']);
  });

  it('掛かった個体は、移し替えずにそのまま増える', () => {
    // **これが1つの型にした値打ち**（TrapSystem.md 1.2節・5.2節）。掛かった個体は既に囲いの中に
    // 居るので、檻から囲いへ移す操作が要らない——**捕らえた後に一度も触らない**。
    open();
    const pen = buildPen();
    tickUntilCaught(pen);
    pourWater(pen);

    for (let i = 0; i < 900 && pennedCount(pen) < 2; i++) tick(1);
    expect(contentsOf(pen, 'catch'), '掛かった個体が増えている').toEqual(['junglefowl', 'junglefowl']);
  });

  it('掛かった個体は、閉じ込められたまま落ち着いて家畜になる', () => {
    // 拘束はmodify（実効値への可逆な寄与）だが、警戒の実体値は中でも-1/tickで引き続ける
    // （TrapSystem.md 5節）。**生かす罠から飼いならしへ続く道**（同5.2節）がこれで、掛かってすぐの
    // 個体は上の「荒ぶる獣は囲いへ入れられない」で拒まれる側に居る。
    open();
    const pen = buildPen();
    const prey = tickUntilCaught(pen);
    tick(40);

    const penned = pen.getSlot(codex.slotNames.getId('catch'));
    expect(prey.moveToSlotOrRejection(land.getSlot(codex.slotNames.getId('items')))).toBeUndefined();
    expect(prey.tryGetProperty(warinessId)!.getEffectiveValue(), '出しても暴れない').toBe(0);
    expect(prey.moveToSlotOrRejection(penned), '落ち着いた個体として入り直せる').toBeUndefined();
  });

  it('飼葉は寄せる餌でもある', () => {
    // 草食の獣が寄ってくる量と、草食の獣が食べる量は同じ1つの量（TrapSystem.md 4.1節）。
    // 与えるのは罠へ餌を仕掛けるのとまったく同じ形。
    open();
    const pen = spawnInto('pen', land, 'fixtures');
    const before = {
      miss: pen.tryGetProperty(missWeightId)!.getEffectiveValue(),
      herbivore: pen.tryGetProperty(herbivoreWeightId)!.getEffectiveValue(),
    };

    const taro = spawnInto('taro', player, 'hand');
    expect(
      pen
        .combinationsWith(taro, player)
        .find((combination) => combination.name === 'feed')
        ?.tryExecute() === true,
    ).toBe(true);

    expect(pen.tryGetProperty(missWeightId)!.getEffectiveValue(), '空振りが減る').toBeLessThan(before.miss);
    expect(
      pen.tryGetProperty(herbivoreWeightId)!.getEffectiveValue(),
      '寄ってくる回が増える',
    ).toBeGreaterThan(before.herbivore);
  });

  it('ネズミは檻に掛からない', () => {
    // **サイズは候補の一覧が持つ**（TrapSystem.md 1.1節）。草原はネズミも宣言している（rat_catch）が、
    // 丸太の隙間から出ていく大きさなので檻の候補には無い——罠の側に「小さすぎる」を表す量は要らない。
    //
    // 引きは固定なので、1つの引きでは同じ候補しか出ない。**引きのほうを振って**一覧を見る。
    const caught = new Set<string>();
    for (const roll of [0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95]) {
      open(roll);
      const pen = buildPen();
      for (let i = 0; i < 60; i++) {
        tick(1);
        for (const object of pen.tryGetSlot(codex.slotNames.getId('catch'))!.contents) {
          caught.add(object.def.name);
          object.destroy();
        }
      }
    }

    expect(caught, '掛かるものはある').toContain('junglefowl');
    expect([...caught], 'ネズミは掛からない').toEqual(['junglefowl']);
  });

  it('囲いは丸太と縄から作れる', () => {
    // 罠の檻（TrapSystem.md 1.2節）と同じ材料。**生かして扱う設備は常に高くつく**。
    open();
    const def = codex.objects.get(codex.objectNames.getId('pen'));
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
    expect(spawnInto('pen', land, 'fixtures').moveToSlotOrRejection(hand)).toBeDefined();
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
