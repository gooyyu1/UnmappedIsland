import { describe, expect, it } from 'vitest';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { World } from '../../src/domain/wrappers/World';
import { seededRng } from '../../src/domain/Rng';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * 時間の経過そのものから生える圧（docs/world/Characters.md ホームシック節）を、同梱のYAMLに対して
 * 通しで確かめる。見るのは「日数 → 孤独 → ホームシック → 幸福度」の鎖1本と、それを抑える2つの手。
 *
 * **1日ぶんを96 tick回して日付を1つ進める**、を必要な日数だけ繰り返す。日付（worldのday）が
 * tickでは進まない（hourを進めるのはWorldSession）ので、ここで直接置く。
 *
 * **1人で測れば足りる。** 3つのプロパティはどれも個体差を持たず player_character trait が配るので、
 * 全キャラクタを走査するのはcharactersYaml.test.tsの受け持ち（そちらが宣言の欠落を見る）。
 */
const codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();

const TICKS_PER_DAY = 96;

function propertyId(name: string): number {
  return codex.propertyNames.getId(name);
}

/**
 * 火の通った1食が戻す幸福度（docs/world/Characters.md 幸福度節）。**書き写さずに1回食べて測る**
 * ——食べ物側の値が動いたら、下の「86日目に0へ届く」もその場で動くべきなので。
 */
const COOKED_MEAL = ((): number => {
  const session = new WorldSession(codex);
  const eater = new WorldObject(1, codex.objects.get(codex.objectNames.getId('captain')), session);
  const meal = new WorldObject(2, codex.objects.get(codex.objectNames.getId('roasted_meat')), session);
  const happiness = eater.getProperty(propertyId('happiness'));
  happiness.setNumberWithoutEvents(0);

  expect(meal.tryGetAction('eat', eater)?.tryExecute() === true).toBe(true);

  return happiness.number;
})();

interface Island {
  readonly session: WorldSession;
  readonly world: WorldObject;
  readonly land: WorldObject;
  readonly elsewhere: WorldObject;
  readonly player: WorldObject;
}

/** 砂浜に立つ主人公と、遠征先になるもう1つの砂浜。 */
function settle(): Island {
  const session = new WorldSession(codex, undefined, seededRng(1));
  const world = new WorldObject(0, codex.objects.get(codex.objectNames.getId('world')), session);
  session.adoptWorld(new World(world, codex));

  const lands = [0, 1].map(() => {
    const land = session.createObject(codex.objectNames.getId('sandy_beach'));
    expect(land.moveToSlotOrRejection(world.getSlot(codex.slotNames.getId('locations')))).toBeUndefined();
    return land;
  });
  const player = session.createObject(codex.objectNames.getId('captain'));
  expect(player.moveToSlotOrRejection(lands[0].getSlot(codex.slotNames.getId('characters')))).toBeUndefined();

  return { session, world, land: lands[0], elsewhere: lands[1], player };
}

/** その土地へ囲いを据え、中へ1つ入れる。飼葉と水は下のfeedPenが与える。 */
function buildPen(island: Island, land: WorldObject, penned = 'junglefowl'): WorldObject {
  const pen = island.session.createObject(codex.objectNames.getId('pen'));
  expect(pen.moveToSlotOrRejection(land.getSlot(codex.slotNames.getId('fixtures')))).toBeUndefined();
  const inside = island.session.createObject(codex.objectNames.getId(penned));
  expect(inside.moveToSlotOrRejection(pen.getSlot(codex.slotNames.getId('catch')))).toBeUndefined();
  return pen;
}

/** 囲いの飼葉と飲み水を満たす（世話を続けている状態）。 */
function feedPen(pen: WorldObject): void {
  pen.getProperty(propertyId('fodder')).setNumber(96);
  pen.getProperty(propertyId('drinking_water')).setNumber(4000);
}

/**
 * 見たいのは心の一本だけなので、身体のほうは毎日満たしておく。水も食べ物も切らさずに過ごした日々で
 * なければ2日で渇き死ぬし、脂とビタミンが尽きれば痛みが立って（fat_starved・scurvy）、
 * **ホームシックではなく痛みが幸福度を削り始める**。
 */
function tendBody(player: WorldObject): void {
  for (const name of [
    'hydration',
    'wakefulness',
    'stamina',
    'warmth',
    'vitamin',
    'carbohydrate',
    'protein',
    'lipid',
  ])
    player.getProperty(propertyId(name)).setNumber(player.getProperty(propertyId(name)).def.range!.max);
  player.getProperty(propertyId('satiety')).setNumber(900);
  player
    .getProperty(propertyId('body_fat'))
    .setNumber(player.getProperty(propertyId('body_fat')).def.range!.max / 4);
}

interface Plan {
  /** 1日に口へ入れる、火の通った食事の数（0なら幸福度は何も戻らない）。 */
  readonly cookedMeals?: number;
  /** この日の朝、飼いならした獣の居る囲いを据える。 */
  readonly penFromDay?: number;
  /** 据える囲いの数（既定は1）。 */
  readonly pens?: number;
  /** この日の朝、世話をやめる（飼葉と水を与えなくなる）。 */
  readonly neglectFromDay?: number;
  /** この日の朝、隣の砂浜へ発つ。 */
  readonly leaveFromDay?: number;
  /**
   * 土地の居心地を直に置く。**住居の部品はまだ世界に1つも無い**（docs/world/Dwellings.md）ので、
   * 建て終えた住居の代わりに置く。押し上げ方（部品のmodify）ではなく、受け取る側の段を見る。
   */
  readonly landComfort?: number;
}

/** 1日ぶんの観測。添字は「日 - 1」。 */
interface Trace {
  /** その日の終わりのホームシック。 */
  readonly homesickness: readonly number[];
  /** その日いちばん落ちたときの幸福度。**食事の合間に沈む底**なので、削られ始めた日がここに出る。 */
  readonly lowestHappiness: readonly number[];
  /** その日の終わりの、今いる場所の連れ（世話をしている獣が居るか）。 */
  readonly company: readonly number[];
}

/** 1日目から数えてdays日ぶん暮らす。 */
function live(days: number, plan: Plan = {}): Trace {
  const island = settle();
  const homesickness: number[] = [];
  const lowestHappiness: number[] = [];
  const company: number[] = [];
  const happiness = island.player.getProperty(propertyId('happiness'));
  const meals = plan.cookedMeals ?? 0;
  let pens: WorldObject[] = [];
  if (plan.landComfort !== undefined)
    island.land.getProperty(propertyId('comfort')).setNumber(plan.landComfort);

  for (let day = 1; day <= days; day++) {
    if (day === plan.penFromDay)
      pens = Array.from({ length: plan.pens ?? 1 }, () => buildPen(island, island.land));
    if (day === plan.leaveFromDay)
      expect(
        island.player.moveToSlotOrRejection(island.elsewhere.getSlot(codex.slotNames.getId('characters'))),
      ).toBeUndefined();

    island.world.getProperty(propertyId('day')).setNumber(day);
    tendBody(island.player);
    if (plan.neglectFromDay === undefined || day < plan.neglectFromDay) pens.forEach(feedPen);

    let lowest = happiness.number;
    for (let tick = 0; tick < TICKS_PER_DAY; tick++) {
      // 食事は1日のうちへ等間隔に置く。まとめて1回にすると、食べる直前の底が実際より深くなる。
      if (meals > 0 && tick % (TICKS_PER_DAY / meals) === 0) happiness.add(COOKED_MEAL);
      island.world.tick();
      lowest = Math.min(lowest, happiness.number);
    }

    homesickness.push(island.player.getProperty(propertyId('homesickness')).number);
    lowestHappiness.push(lowest);
    company.push(island.player.getProperty(propertyId('company')).getEffectiveValue());
  }

  return { homesickness, lowestHappiness, company };
}

/** その値が初めてしきい値へ届いた日（1始まり）。届かなければ0。 */
function firstDayReaching(values: readonly number[], threshold: number): number {
  return values.findIndex((value) => value >= threshold) + 1;
}

describe('ホームシック(docs/world/Characters.md ホームシック節)', () => {
  it('最初の凪の季節は溜まらない', () => {
    // 生き延びるだけで手一杯の30日は、孤独がoccupied段に留まる。
    const trace = live(29);

    expect(trace.homesickness[28]).toBe(0);
  });

  it('孤独の段が上がるごとに、溜まる速さが倍になる', () => {
    const trace = live(91);
    const perDay = (day: number) => trace.homesickness[day - 1] - trace.homesickness[day - 2];

    expect(perDay(31), '雨季（30日目〜）は1日0.96').toBeCloseTo(0.96, 6);
    expect(perDay(61), '乾季（60日目〜）はその倍').toBeCloseTo(1.92, 6);
    expect(perDay(91), '90日目からはさらに倍').toBeCloseTo(3.84, 6);
  });

  it('56日目に表へ出て、そこから幸福度が削られ始める', () => {
    // 留意域（max の1/4）へ入った時点でステータスエリアに行が出る（docs/ui/StatusArea.md 1節）。
    // 最初の雨季が明ける60日目より少し前で、1周回115日の半分にも届いていない。
    const trace = live(60, { cookedMeals: 3 });

    expect(firstDayReaching(trace.homesickness, 25)).toBe(56);
    expect(trace.lowestHappiness[54], '55日目までは1も削られない').toBe(100);
    expect(trace.lowestHappiness[55], '56日目から削られ始める').toBeLessThan(100);
  });

  it('対策を何も打たなければ、最良の食事を通しても86日目に幸福度が0へ届く', () => {
    // 火を通した3食で+18/日。**追いつくのは最初の段まで**で、里心が深まれば-24/日・-48/日になり、
    // 食事では埋まらない。1周回115日（ContentSkeleton.md 8.3節）の3/4で心が尽きる。
    const trace = live(115, { cookedMeals: 3 });

    expect(trace.lowestHappiness.findIndex((value) => value === 0) + 1).toBe(86);
  });

  it('飼葉を切らさない囲いに獣が1頭居れば、その土地が連れになる', () => {
    const trace = live(1, { penFromDay: 1 });

    expect(trace.company[0]).toBe(1);
  });

  it('締めた家畜の死体は、慰めにならない', () => {
    // 囲いの枠は死体も受ける（quarry、farming.yaml）ので、生きているかどうかで分かれる。
    const island = settle();
    feedPen(buildPen(island, island.land, 'junglefowl_carcass'));

    island.world.tick();

    expect(island.player.getProperty(propertyId('company')).getEffectiveValue()).toBe(0);
  });

  it('その囲いが、60日目から90日目までの増えをちょうど止める', () => {
    // 連れの引き（-1.92/日）が、lonely段の溜め（+1.92/日）と釣り合う。里心が募ってから
    // 囲いを建てても、そこで止まる。
    const trace = live(89, { penFromDay: 65 });

    expect(trace.homesickness[63], '65日目の朝までに溜まった分').toBeGreaterThan(30);
    expect(trace.homesickness[88], '89日目まで1つも増えない').toBeCloseTo(trace.homesickness[63], 6);
  });

  it('囲いを並べても、慰めは増えない', () => {
    // 受ける側の段が1つだけなので、90日目からの増え（+3.84/日）は囲いをいくつ据えても止まらない
    // ——**家畜だけでは最後まで持たない**（docs/world/Characters.md ホームシック節）。
    const alone = live(95, { penFromDay: 65 });
    const many = live(95, { penFromDay: 65, pens: 3 });

    // 数えているのは「獣の居る囲いの数」。中で増えた群れは1日1甕の水では足りずに減るので、
    // 3つ据えても最後まで3つが埋まっているとは限らない——見たいのは1より大きいことだけ。
    expect(many.company[94], '囲いを並べれば土地の連れは増える').toBeGreaterThan(1);
    expect(many.homesickness[94], 'それでも1つのときと同じだけ募る').toBeCloseTo(alone.homesickness[94], 6);
    expect(many.homesickness[94], '90日目からは止まらない').toBeGreaterThan(many.homesickness[88]);
  });

  it('90日目からを止められるのは、snugまで設えた住居か、家と家畜の両方', () => {
    // 引きは足し合わさるので、homely（-1.92/日）と連れ（-1.92/日）でforsaken（+3.84/日）に届く。
    const bare = live(95, { landComfort: 20 });
    const both = live(95, { landComfort: 20, penFromDay: 1 });
    const snug = live(95, { landComfort: 50 });

    expect(bare.homesickness[94], '家だけでは90日目から募る').toBeGreaterThan(bare.homesickness[88]);
    expect(both.homesickness[94], '家と家畜なら止まる').toBe(0);
    expect(snug.homesickness[94], 'snugの住居だけでも止まる').toBe(0);
  });

  it('世話を切らせば、慰めも切れる', () => {
    // 増えるのを止めるゲート（animals.yamlのbreeding_remaining）と同じ飼葉に乗せている。
    const trace = live(89, { penFromDay: 65, neglectFromDay: 75 });

    expect(trace.company[88]).toBe(0);
    expect(trace.homesickness[88]).toBeGreaterThan(trace.homesickness[73]);
  });

  it('遠征に出れば効かない', () => {
    // 継ぐのは今居る場所の連れだけ（characters/player_character.yamlのcompany）。
    const trace = live(89, { penFromDay: 65, leaveFromDay: 75 });

    expect(trace.company[88]).toBe(0);
    expect(trace.homesickness[88]).toBeGreaterThan(trace.homesickness[73]);
  });
});
