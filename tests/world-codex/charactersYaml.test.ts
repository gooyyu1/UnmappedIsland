import { describe, expect, it } from 'vitest';
import type { ObjectDef } from '../../src/domain/ObjectDef';
import type { PropertyDef } from '../../src/domain/PropertyDef';
import { characterDefNames, resolveCharacterDefNameOrFirst } from '../../src/domain/generation/NewGame';
import { PlayerCharacter } from '../../src/domain/wrappers/PlayerCharacter';
import { World } from '../../src/domain/wrappers/World';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { characterIcon } from '../../src/game/view/characterCard';
import { bundledCodex } from '../support/worldCodexFiles';

// describe.eachへ渡すため、beforeAllではなく読み込み時にCodexを組み立てる。
const codex = bundledCodex();
const characters = characterDefNames(codex);

function def(name: string): ObjectDef {
  return codex.objects.get(codex.objectNames.getId(name));
}

function propOf(objectDef: ObjectDef, propertyName: string): PropertyDef {
  const prop = objectDef.tryGetPropertyDef(codex.propertyNames.getId(propertyName));
  if (prop === undefined) throw new Error(`'${objectDef.name}' はプロパティ'${propertyName}'を持ちません。`);
  return prop;
}

function maxOf(character: string, propertyName: string): number {
  const range = propOf(def(character), propertyName).range;
  if (range === undefined) throw new Error(`'${character}'.${propertyName} はrangeを持ちません。`);
  return range.max;
}

/** 1 tickぶん時間を進めたときの、そのプロパティの減り幅。 */
function decayPerTick(character: string, propertyName: string): number {
  const session = new WorldSession(codex);
  const instance = new WorldObject(1, def(character), session);
  const propertyId = codex.propertyNames.getId(propertyName);
  const before = instance.tryGetProperty(propertyId)?.number ?? 0;

  instance.tick();

  return before - (instance.tryGetProperty(propertyId)?.number ?? 0);
}

/**
 * 痛みをその段へ置いて1 tick進めたときの、幸福度の減り幅（docs/world/Characters.md 幸福度節）。
 * **置くのは段の下限**で、条件の側へ閾値を書き写さないため。
 */
function happinessDrainInStage(character: string, stageName: string): number {
  const instance = new WorldObject(1, def(character), new WorldSession(codex));
  const happinessId = codex.propertyNames.getId('happiness');
  const stage = propOf(def(character), 'pain').stages.find((one) => one.name === stageName);
  if (stage === undefined) throw new Error(`痛みに段'${stageName}'がありません。`);
  instance.getProperty(codex.propertyNames.getId('pain')).setNumber(stage.min ?? 0);
  const before = instance.getProperty(happinessId).number;

  instance.tick();

  return before - instance.getProperty(happinessId).number;
}

/**
 * 砂浜に立たせたキャラクタ。死ぬと世界から外れる（VitalsSystem.md 6節）ので、それを見るには
 * 居場所を持たせて始める必要がある。
 */
function stand(character: string): {
  player: PlayerCharacter;
  session: WorldSession;
  world: WorldObject;
  land: WorldObject;
} {
  const session = new WorldSession(codex);
  const worldInstance = new WorldObject(0, def('world'), session);
  session.adoptWorld(new World(worldInstance, codex));
  const beach = session.createObject(codex.objectNames.getId('sandy_beach'));
  expect(
    beach.moveToSlotOrRejection(worldInstance.getSlot(codex.slotNames.getId('locations'))),
  ).toBeUndefined();
  const instance = session.createObject(codex.objectNames.getId(character));
  expect(instance.moveToSlotOrRejection(beach.getSlot(codex.slotNames.getId('characters')))).toBeUndefined();
  return { player: new PlayerCharacter(instance, codex), session, world: worldInstance, land: beach };
}

/** 寒さの入口（`chill_point`）の素の値（VitalsSystem.md 8.3節）。 */
const CHILL_POINT = 16;

/**
 * 寒さの入口を下回る夜にして、天気を1つ据える（VitalsSystem.md 8.3節）。**世界はtickさせない**ので、
 * 以後この気温と天気のまま動かない——見たいのはキャラクタ側の削りだけで、気候の巡りは
 * climateSystem.test.tsが受け持つ。
 */
function chillTheWorld(world: WorldObject, weatherName: string): void {
  world.getProperty(codex.propertyNames.getId('ambient_temperature')).setNumber(CHILL_POINT - 4);
  world
    .getProperty(codex.propertyNames.getId('weather'))
    .setNumberWithoutEvents(codex.symbolNames.getId(weatherName));
}

/** その土地へ、火の点いた炉を1つ据える（fire.yamlのcampfire。暖は親の気温を+8する）。 */
function setHearth(session: WorldSession, land: WorldObject): void {
  const hearth = session.createObject(codex.objectNames.getId('campfire'));
  expect(hearth.moveToSlotOrRejection(land.getSlot(codex.slotNames.getId('fixtures')))).toBeUndefined();
  hearth.getProperty(codex.propertyNames.getId('fuel')).setNumber(5);
  hearth.getProperty(codex.propertyNames.getId('heat')).setNumber(1);
}

/** そのキャラクタを、雨の当たらない浅い洞窟（locations.yamlのshallow_cave）の中へ入れる。 */
function moveIntoCave(session: WorldSession, land: WorldObject, player: PlayerCharacter): void {
  const cave = session.createObject(codex.objectNames.getId('shallow_cave'));
  expect(cave.moveToSlotOrRejection(land.getSlot(codex.slotNames.getId('fixtures')))).toBeUndefined();
  expect(
    player.instance.moveToSlotOrRejection(cave.getSlot(codex.slotNames.getId('characters'))),
  ).toBeUndefined();
}

/** 熱の増減を測るときの居場所。どちらも指定しなければ、雨の当たる野ざらし。 */
interface Place {
  readonly inCave?: boolean;
  readonly hearth?: boolean;
}

/**
 * 寒さの入口を下回る夜に1 tick置いたときの、熱の増減（VitalsSystem.md 8.3節）。満タンでも下限でも
 * 頭打ちに掛からないよう、真ん中の位置から測る。
 */
function warmthChange(character: string, weatherName: string, place: Place): number {
  const { player, session, world, land } = stand(character);
  chillTheWorld(world, weatherName);
  if (place.inCave === true) moveIntoCave(session, land, player);
  if (place.hearth === true) setHearth(session, land);

  const warmthId = codex.propertyNames.getId('warmth');
  player.instance.tryGetProperty(warmthId)?.setNumber(maxOf(character, 'warmth') / 2);
  const before = player.instance.tryGetProperty(warmthId)?.number ?? 0;

  player.instance.tick();

  return (player.instance.tryGetProperty(warmthId)?.number ?? 0) - before;
}

/** 熱の削りと戻りが、居場所と天気でどう変わるか（VitalsSystem.md 8.3節）。 */
const WARMTH_CASES: readonly { situation: string; weather: string; place: Place; perTick: number }[] = [
  { situation: '寒い夜に野ざらしでも、雨が降っていなければ', weather: 'clear', place: {}, perTick: -2 },
  {
    situation: '寒い雨の夜でも、岩屋根の下なら',
    weather: 'heavy_rain',
    place: { inCave: true },
    perTick: -2,
  },
  { situation: '寒い雨の夜に野ざらしなら', weather: 'heavy_rain', place: {}, perTick: -6 },
  {
    situation: '炉の暖が気温を入口より上へ戻していれば',
    weather: 'heavy_rain',
    place: { hearth: true },
    perTick: 8,
  },
];

/** 休息（docs/world/Characters.md 休息節）の4つ。長さの短い順。 */
const RESTS = [
  ['wait', 15],
  ['rest', 60],
  ['nap', 180],
  ['sleep', 360],
] as const;

/**
 * 限界に達した値が起こす、強制的な時間経過（docs/world/Characters.md 限界節）。見る値と、それが
 * 尽きたときに起きる手番の名前。**起きることそのものは
 * tests/world-codex/forcedTimePassage.test.ts** が通す。
 */
const LIMITS = [
  ['stamina', 'collapse'],
  ['wakefulness', 'fall_asleep'],
  ['happiness', 'despair'],
] as const;

/**
 * 休息を1回取ったときの、実際に戻った量。眠っている間も覚醒度は減り続けるので、覚醒度のほうは
 * 経過ぶんを差し引いた実質の回復になる。
 *
 * 頭打ちに掛かると回復量そのものを測れないため、体力は空から、覚醒度は経過ぶん（1/tick）だけ
 * 残した位置から始める。この位置なら下限でも上限でも切られない。
 *
 * **覚醒度だけは、そこから更に1だけ上へ置く**（SPARE）。経過し切って下限へ着くと、休息を終えた
 * 切れ目で強制的な睡眠が挟まり（docs/world/Characters.md 限界節）、休息そのものの回復量を
 * 測れなくなる。体力は空から測ってよい——どの休息も体力を戻すので、切れ目では限界を抜けている。
 */
function takeRest(
  character: string,
  actionName: string,
): { minutes: number; stamina: number; wakefulness: number } {
  const SPARE = 1;
  const { player } = stand(character);
  const staminaId = codex.propertyNames.getId('stamina');
  const wakefulnessId = codex.propertyNames.getId('wakefulness');
  const minutes = player.instance.tryGetAction(actionName, player.instance)?.executionMinutes() ?? 0;
  const spent = minutes / 15;

  player.instance.tryGetProperty(staminaId)?.setNumber(0);
  player.instance.tryGetProperty(wakefulnessId)?.setNumber(spent + SPARE);

  expect(player.instance.tryGetAction(actionName, player.instance)?.tryExecute() === true).toBe(true);

  return {
    minutes,
    stamina: player.instance.tryGetProperty(staminaId)?.number ?? 0,
    wakefulness: (player.instance.tryGetProperty(wakefulnessId)?.number ?? 0) - spent - SPARE,
  };
}

/**
 * characters/ の全キャラクタが満たすべき契約（docs/world/Characters.md）。数値はキャラクタごとに
 * 違ってよいが、定義の欠落と、最大値としきい値の食い違いは許さない。検査対象はcharacterタグで引くので、
 * キャラクタを1つ足せば自動でこのテストの対象になる。
 */
describe('プレイヤーキャラクタの定義', () => {
  it('選べるキャラクタが2体以上いる', () => {
    // 以降の走査は対象が空でも通ってしまうため、土台があること自体をここで確かめる。
    expect(characters.length).toBeGreaterThanOrEqual(2);
  });

  it('セーブに残っていた識別子が未知でも、先頭のキャラクタで開ける', () => {
    expect(resolveCharacterDefNameOrFirst(codex, characters[1])).toBe(characters[1]);
    expect(resolveCharacterDefNameOrFirst(codex, 'いなくなったキャラクタ')).toBe(characters[0]);
  });

  describe.each(characters)('%s', (character) => {
    it('シングルトンで、characterタグを持つ', () => {
      expect(def(character).isSingleton).toBe(true);
      expect(def(character).tags).toContain(codex.tagNames.getId('character'));
    });

    it('固定枠の手持ちスロットと、装備・怪我のスロットを持つ', () => {
      const hand = def(character).tryGetSlotDef(codex.slotNames.getId('hand'));

      expect(hand, '手持ちスロットを持つ').toBeDefined();
      // 枠数は個体差にしてよいが、ハンドレーンに収まる範囲に留める（ScreenLayout.md 7.3節）。数を決めて
      // いるので、持ち替えても枠の位置は動かない（SlotSystem.md 3節）。
      expect(hand?.cellCount, '手持ちは4〜8枠').toBeGreaterThanOrEqual(4);
      expect(hand?.cellCount, '手持ちは4〜8枠').toBeLessThanOrEqual(8);

      for (const slotName of ['equipment', 'injuries'])
        expect(
          def(character).tryGetSlotDef(codex.slotNames.getId(slotName)),
          `${slotName} スロットを持つ`,
        ).toBeDefined();
    });

    it('外から見えるのは装備と怪我だけ（手持ちはレーンに出ている）', () => {
      // 手持ちをタブにも出すと、同じ札が画面に2枚出る（Windows.md 1.1節）。
      expect(def(character).visibleSlotGlobalIds).toEqual([
        codex.slotNames.getId('equipment'),
        codex.slotNames.getId('injuries'),
      ]);
    });

    it.each([
      ['pain', ['status', 'health']],
      ['blood', ['status', 'health']],
      ['warmth', ['status', 'health']],
      ['satiety', ['status', 'nutrition']],
      ['hydration', ['status', 'nutrition']],
      ['body_fat', ['nutrition']],
      ['wakefulness', ['status', 'health']],
      ['stamina', ['status', 'health']],
      ['load', ['status', 'health']],
      ['carbohydrate', ['nutrition']],
      ['protein', ['nutrition']],
      ['lipid', ['nutrition']],
      // ビタミンだけは在庫の3本と違い、尽きた先（壊血病）を段が持つのでステータスエリアに出す
      // （DigestionSystem.md 4節）。
      ['vitamin', ['status', 'nutrition']],
      // メンタルの不調を代表する1本（Characters.md 幸福度節）。心も健康のうちなので、専用のタブは
      // 作らずhealthへ入れる。
      ['happiness', ['status', 'health']],
      // 時間の経過から生える圧（同 ホームシック節）。**プレイヤーが読むのはこちら**なので、
      // 溜める側の孤独と抑える側の居心地はstatusを持たない（下のテスト）。
      ['homesickness', ['status', 'health']],
      // 全身の菌（DigestionSystem.md 6節）。発症したときだけステータスエリアに出る。
      ['pathogen', ['status', 'health']],
      // 免疫はステータスエリアには出さず、カードを開いたときだけ見える（body_fatと同じ扱い）。
      ['immunity', ['health']],
    ])('%sを持ち、期待されるプロパティタグが付いている', (propertyName, expectedTags) => {
      const tagNames = propOf(def(character), propertyName).tags.map((id) =>
        codex.propertyTagNames.getName(id),
      );

      expect(tagNames.sort()).toEqual([...expectedTags].sort());
    });

    it('孤独と、抑える側の2つは画面に出ない', () => {
      // 見えない値が結果だけを変える形にしないため、読ませるのは間のホームシックだけにする
      // （Characters.md ホームシック節）。
      for (const propertyName of ['loneliness', 'comfort', 'company'])
        expect(propOf(def(character), propertyName).tags, `${propertyName} はstatusを持たない`).toEqual([]);
    });

    it('ステータスエリアに出るのは12件で、並び順も揃っている', () => {
      // propertiesWithTagの戻り順＝宣言順がそのまま画面の並びになる（StatusArea.md 3節）。
      const instance = new WorldSession(codex).createObject(def(character).globalId);
      const status = instance.propertiesWithTag(codex.propertyTagNames.getId('status'));

      expect(status.map((property) => property.def.name)).toEqual([
        'pain',
        'blood',
        'warmth',
        'satiety',
        'vitamin',
        'homesickness',
        'happiness',
        'pathogen',
        'hydration',
        'wakefulness',
        'stamina',
        'load',
      ]);
    });

    it.each([
      'pain',
      'blood',
      'warmth',
      'satiety',
      'hydration',
      'body_fat',
      'wakefulness',
      'stamina',
      'load',
      'happiness',
      'homesickness',
    ])('%sは0を下限とするrangeを持つ', (propertyName) => {
      expect(propOf(def(character), propertyName).range?.min).toBe(0);
    });

    it.each([
      // 時間を数えるクラスは基準レートが1/tickで、maxが「何tick保つか」を直接表す（6.0節）。
      ['wakefulness', 1],
      ['satiety', 16],
      ['vitamin', 0.5],
      ['hydration', 1],
      // 体力は行動で減るもので、時間では減らない。
      ['stamina', 0],
      // 荷重は中身から導出されるので、自分では動かない。
      ['load', 0],
      // 痛みは負っている怪我から導出されるので、自分では動かない。
      ['pain', 0],
      // 血は自分で戻る唯一のステータスだが、満タンで始まるので上限で頭打ちになる（次のテスト）。
      ['blood', 0],
      // 幸福度は時間では動かない。削るのは痛みとホームシックの段で、どちらも無ければ1も減らない
      // （下のテスト）。
      ['happiness', 0],
      // ホームシックも時間では動かない。溜めるのは孤独の段で、漂着した初日には1も溜まらない
      // （tests/world-codex/homesickness.test.ts）。
      ['homesickness', 0],
      // 満腹感はかさ（mL）なので、1 tickあたり16mLずつ空いていく（DigestionSystem.md 2節）。
      // ビタミンはmgで、代謝回転が1日48mg（同4節）。栄養素の在庫は減るのではなく体脂肪へ移る。
    ])('%sはtickごとに%iずつ減る', (propertyName, expectedDecay) => {
      expect(decayPerTick(character, propertyName)).toBe(expectedDecay);
    });

    it('水分と幸福度は安全域のやや下、覚醒度と体力は満タン、体脂肪は最大値の1/4から始まる', () => {
      const instance = new WorldSession(codex).createObject(def(character).globalId);

      // 開始直後からステータスバーに出るよう、安全域の境目（80%）のやや下の75%から始める（Characters.md）。
      for (const propertyName of ['hydration', 'happiness'])
        expect(
          instance.tryGetProperty(codex.propertyNames.getId(propertyName))?.number ?? 0,
          `${propertyName} は最大値の3/4で始まる`,
        ).toBe((maxOf(character, propertyName) * 3) / 4);

      for (const propertyName of ['wakefulness', 'stamina'])
        expect(
          instance.tryGetProperty(codex.propertyNames.getId(propertyName))?.number ?? 0,
          `${propertyName} は満タンで始まる`,
        ).toBe(maxOf(character, propertyName));

      // 太っても痩せてもいない標準体格の位置（Characters.md）。
      expect(instance.tryGetProperty(codex.propertyNames.getId('body_fat'))?.number ?? 0).toBe(
        maxOf(character, 'body_fat') / 4,
      );
    });

    // 満腹感はここに含めない。maxが容量ではなく感じ方の頂点で、実際に取る値の分布から刻むため
    // （DigestionSystem.md 2節）。
    it.each(['hydration', 'wakefulness', 'stamina', 'blood', 'vitamin', 'happiness'])(
      '%sは最大値の80%%を下回ると安全域から外れる',
      (propertyName) => {
        // 最大値だけ変えてstagesを直し忘れると、ステータスエリアに出始める位置がずれる。
        const prop = propOf(def(character), propertyName);
        // 端数は丸める（96の80%は76.8なので77）。段の閾値は人が読む数字なので小数にしない。
        const threshold = Math.round(maxOf(character, propertyName) * 0.8);

        expect(prop.alertOf(threshold), '80%ちょうどはまだ安全域').toBe('safe');
        expect(prop.alertOf(threshold - 1)).not.toBe('safe');
      },
    );

    it('水分は満水ちょうどのときだけfull段に入る', () => {
      // 液体のdrinkがこの名前で「もう飲めない」を見る（liquid_containers.yaml・Characters.md）。
      const prop = propOf(def(character), 'hydration');
      const max = maxOf(character, 'hydration');

      expect(prop.isInStage(max, 'full')).toBe(true);
      expect(prop.isInStage(max - 1, 'full')).toBe(false);
    });

    // 荷重・痛み・ホームシックは増える側が悪いので、境目は最大値からの割合で刻む（Characters.md）。
    it.each(['load', 'pain', 'homesickness'])('%sの域は最大値からの割合で切られる', (propertyName) => {
      const prop = propOf(def(character), propertyName);
      const max = maxOf(character, propertyName);

      expect(prop.alertOf(0), '0は安全域').toBe('safe');
      expect(prop.alertOf(Math.trunc(max / 4)), '1/4で留意域').toBe('watch');
      expect(prop.alertOf(Math.trunc(max / 2)), '1/2で要注意域').toBe('caution');
      expect(prop.alertOf(Math.trunc((max * 5) / 6)), '5/6で危険域').toBe('danger');
    });

    it('荷重の危険域の段だけがtoo_heavyという名前を持つ', () => {
      // 道のtravelがこの名前で見る（locations.yaml・ContainerSystem.md 5節）。
      const prop = propOf(def(character), 'load');
      const threshold = (maxOf(character, 'load') * 5) / 6;

      expect(prop.isInStage(threshold, 'too_heavy')).toBe(true);
      expect(prop.isInStage(threshold - 1, 'too_heavy')).toBe(false);
    });

    it.each(['load', 'pain', 'homesickness'])('%sは増えるほど悪い値として扱われる', (propertyName) => {
      // バーの向きと増減の記号の色が反転する（StatusArea.md）。
      expect(propOf(def(character), propertyName).worsensUpward).toBe(true);
      expect(propOf(def(character), 'stamina').worsensUpward).toBe(false);
    });

    // 最大値が違っても「あと何時間で赤くなるか」は揃える（Characters.md）。1時間 = 4 tick。
    it.each(['wakefulness'])('%sの域は残り時間で切られる', (propertyName) => {
      const prop = propOf(def(character), propertyName);
      const perHour = decayPerTick(character, propertyName) * 4;

      expect(prop.alertOf(perHour * 3), '残り3時間').toBe('caution');
      expect(prop.alertOf(perHour * 3 - 1)).toBe('danger');
      expect(prop.alertOf(perHour * 12), '残り12時間').toBe('watch');
      expect(prop.alertOf(perHour * 12 - 1)).toBe('caution');
    });

    it('水分の域は残り時間で切られ、尽きると致命的域に入る', () => {
      const prop = propOf(def(character), 'hydration');
      const perHour = decayPerTick(character, 'hydration') * 4;

      expect(prop.alertOf(perHour * 6), '残り6時間').toBe('danger');
      expect(prop.alertOf(perHour * 6 - 1)).toBe('fatal');
      expect(prop.alertOf(perHour * 24), '残り1日').toBe('caution');
      expect(prop.alertOf(perHour * 24 - 1)).toBe('danger');
      expect(prop.alertOf(perHour * 48), '残り2日').toBe('watch');
      expect(prop.alertOf(perHour * 48 - 1)).toBe('caution');
    });

    it('体力の域は最大値に対する割合で切られる', () => {
      // tickで減らないため、残り時間では切れない（Characters.md）。
      const prop = propOf(def(character), 'stamina');
      const max = maxOf(character, 'stamina');

      expect(prop.alertOf(Math.trunc(max * 0.6))).toBe('watch');
      expect(prop.alertOf(Math.trunc(max * 0.6) - 1)).toBe('caution');
      expect(prop.alertOf(Math.trunc(max * 0.2))).toBe('caution');
      expect(prop.alertOf(Math.trunc(max * 0.2) - 1)).toBe('danger');
    });

    it('幸福度の域は最大値に対する割合で切られ、致命的域は持たない', () => {
      // 減る速さが今の痛みで変わるので、残り時間では切れない（Characters.md 域の区分節）。尽きても
      // 死なない——0に達したとき何が起きるかはまだ決めていない（同 幸福度節）。
      const prop = propOf(def(character), 'happiness');
      const max = maxOf(character, 'happiness');

      expect(prop.alertOf(Math.trunc(max * 0.5))).toBe('watch');
      expect(prop.alertOf(Math.trunc(max * 0.5) - 1)).toBe('caution');
      expect(prop.alertOf(Math.trunc(max * 0.2))).toBe('caution');
      expect(prop.alertOf(Math.trunc(max * 0.2) - 1)).toBe('danger');
      expect(prop.alertOf(0)).toBe('danger');
    });

    // 内側の不調が幸福度を削る経路は痛みの段で、1段上がるごとに倍（Characters.md 幸福度節）。
    // 怪我・壊血病・脂の欠乏はどれも痛みへ合流するので、この1本が内側の不調すべての届き先になる。
    // 外から時間が掛ける圧はホームシックが受け持つ（tests/world-codex/homesickness.test.ts）。
    it.each([
      ['painless', 0],
      ['sore', 0.125],
      ['hurting', 0.25],
      ['unbearable', 0.5],
    ])('痛みが%sの間、幸福度は1 tickあたり%dずつ削られる', (stageName, perTick) => {
      expect(happinessDrainInStage(character, stageName)).toBe(perTick);
    });

    it('血は自分で戻り、満タンで頭打ちになる', () => {
      // 削るのは出血する怪我（injuries.yaml）だけで、戻すのは自分（Characters.md 値の刻み方節）。
      // ステータスの中でここだけが自分で増える。
      const session = new WorldSession(codex);
      const instance = new WorldObject(1, def(character), session);
      const bloodId = codex.propertyNames.getId('blood');
      const max = maxOf(character, 'blood');
      // **水分は満たしてから測る。** 初期値はmaxの75%＝安全域のやや下（Characters.md 域の区分節）で、
      // そのままでは下の条件で止まる。
      instance
        .tryGetProperty(codex.propertyNames.getId('hydration'))
        ?.setNumber(maxOf(character, 'hydration'));
      instance.tryGetProperty(bloodId)?.setNumber(max - 100);

      instance.tick();

      expect(instance.tryGetProperty(bloodId)?.number ?? 0, '1 tickで2mL戻る').toBe(max - 98);

      for (let i = 0; i < 100; i++) instance.tick();

      expect(instance.tryGetProperty(bloodId)?.number ?? 0, '満タンを超えては溜まらない').toBe(max);
    });

    // 血が戻るのは水分と体脂肪がともに安全域にある間だけ（VitalsSystem.md 3.1節）。**判定は段の名前で
    // 行う**ので、ここで置く値は「その段に入る位置」であって、条件の側の閾値ではない。
    it.each([
      ['hydration', 'dryish'],
      ['body_fat', 'starved'],
    ])('%sが安全域を外れている間は、血が戻らない', (propertyName, stageName) => {
      const session = new WorldSession(codex);
      const instance = new WorldObject(1, def(character), session);
      const bloodId = codex.propertyNames.getId('blood');
      const property = instance.tryGetProperty(codex.propertyNames.getId(propertyName))!;
      const stage = propOf(def(character), propertyName).stages.find((one) => one.name === stageName)!;
      // 水分は満たしておく（体脂肪を見る回で、水分のほうが止めていることにならないように）。
      instance
        .tryGetProperty(codex.propertyNames.getId('hydration'))
        ?.setNumber(maxOf(character, 'hydration'));
      instance.tryGetProperty(bloodId)?.setNumber(1000);
      property.setNumber(stage.min ?? 1);

      instance.tick();

      expect(instance.tryGetProperty(bloodId)?.number ?? 0, `${stageName}では戻らない`).toBe(1000);
    });

    // 寒さは気温と寒さの入口（chill_point）の比較1つで決まり、雨は気温ではなく削る速さに効く
    // （VitalsSystem.md 8.3節）。
    it.each(WARMTH_CASES)('$situation、熱は1 tickあたり$perTick', ({ weather, place, perTick }) => {
      expect(warmthChange(character, weather, place)).toBe(perTick);
    });

    it('雨の夜に野ざらしで居続けると、熱を失って凍死する', () => {
      const { player, world } = stand(character);
      chillTheWorld(world, 'heavy_rain');

      // -6/tickなので、満タンの熱は120 tick（30時間）足らずで尽きる。水分はどのキャラクタも
      // 216 tick以上あるので、ここで先に尽きるのは熱だけ。
      for (let i = 0; i < Math.ceil(maxOf(character, 'warmth') / 6); i++) {
        if (player.ending.kind !== undefined) break;
        player.instance.tick();
      }

      expect(player.ending.kind).toBe('death');
      expect(player.ending.causeOfDeath).toBe('frozen');
    });

    it('同じ夜でも、炉のそばなら死なずに熱が戻る', () => {
      const { player, session, world, land } = stand(character);
      chillTheWorld(world, 'heavy_rain');
      setHearth(session, land);
      const warmthId = codex.propertyNames.getId('warmth');
      const max = maxOf(character, 'warmth');
      player.instance.tryGetProperty(warmthId)?.setNumber(max / 2);

      for (let i = 0; i < Math.ceil(max / 6); i++) player.instance.tick();

      expect(player.ending.kind, '凍死しない').toBeUndefined();
      expect(player.instance.tryGetProperty(warmthId)?.number ?? 0, '満タンまで戻る').toBe(max);
    });

    it('ステータスエリアに出るもののうち、致命的域を持つのは水分と血と熱だけ', () => {
      // 4つ目の死に方（飢え）はbody_fatが持つが、statusタグが無いのでここには現れない
      // （画面に出る飢えの兆しは満腹度、docs/world/Characters.md）。
      const instance = new WorldSession(codex).createObject(def(character).globalId);

      const fatal = instance
        .propertiesWithTag(codex.propertyTagNames.getId('status'))
        .filter((property) => property.def.alertOf(0) === 'fatal');

      expect(fatal.map((property) => property.def.name)).toEqual(['blood', 'warmth', 'hydration']);
    });

    // 死に方は4つだけ（VitalsSystem.md 8節）。どれも「尽きたら世界から出る」という同じ形で、
    // 死因の名前を名乗るのは命を絶ったdestroy（9.3節のreason。画面はその文言を出すだけ）。
    it.each([
      ['hydration', 'dehydrated'],
      ['body_fat', 'starved'],
      ['blood', 'exsanguinated'],
      ['warmth', 'frozen'],
    ])('%sを使い切ると死に、死因は「%s」を名乗る', (propertyName, reason) => {
      const { player } = stand(character);
      const propertyId = codex.propertyNames.getId(propertyName);

      player.instance
        .tryGetProperty(propertyId)
        ?.add(-((player.instance.tryGetProperty(propertyId)?.number ?? 0) - 1));

      expect(player.ending.kind, '下限に達するまでは生きている').toBeUndefined();
      expect(player.ending.causeOfDeath).toBeUndefined();

      player.instance.tryGetProperty(propertyId)?.add(-1);

      expect(player.ending.kind, '下限に達した時点で世界から外れる').toBe('death');
      expect(player.ending.causeOfDeath).toBe(reason);
    });

    /**
     * 命を絶つ宣言の書き忘れを止める見張り（policies.md「宣言漏れの扱い」）。**見るのは
     * 「消えたのに名乗っていない」ことだけ**で、名前が何であるかは上の3件が見ている。
     *
     * 死に方を1つ足したときにreasonを書き忘れると、画面は死因を言えないまま黙って動く。
     * どの値が命を絶つかを列挙せずに、端まで動かして消えたかどうかで拾う。
     */
    it('名乗らずに消えたときは、死因を言わない', () => {
      // 動物の立ち去り（stay_remainingのon_min）と同じ、名前を持たない消滅。**世界から出たことは
      // 死だが、死に方は誰も名乗っていない**ので、画面は死因を出さない（VitalsSystem.md 6節）。
      const { player } = stand(character);

      player.instance.destroy();

      expect(player.ending.kind).toBe('death');
      expect(player.ending.causeOfDeath).toBeUndefined();
    });

    it('端まで動かして消えるなら、必ず死因を名乗る', () => {
      const edges = def(character)
        .enumeratePropertyDefs()
        .flatMap((propertyDef) =>
          propertyDef.range === undefined
            ? []
            : [propertyDef.range.min, propertyDef.range.max].map((edge) => ({ propertyDef, edge })),
        );

      expect(edges.length, '端を持つ値が1つも無ければ、この見張りは何も見ていない').toBeGreaterThan(0);

      for (const { propertyDef, edge } of edges) {
        const { player } = stand(character);
        player.instance.tryGetProperty(propertyDef.globalId)?.setNumber(edge);

        if (player.ending.kind !== 'death') continue;
        expect(
          player.ending.causeOfDeath,
          `'${propertyDef.name}'の端で世界から外れるのに、死因を名乗っていない`,
        ).toBeDefined();
      }
    });

    it.each(RESTS)('休息「%s」を持ち、%i分かかる', (actionName, minutes) => {
      const { player } = stand(character);

      expect(player.instance.tryGetAction(actionName, player.instance)?.executionMinutes() ?? 0).toBe(
        minutes,
      );
    });

    it.each(LIMITS)('%s の限界が「%s」を起こし、それは押せない', (propertyName, turnName) => {
      const { player } = stand(character);

      expect(propOf(def(character), propertyName).range?.min, '限界は下限（0）').toBe(0);
      expect(player.instance.tryGetAction(turnName, player.instance), '手番を持つ').toBeDefined();
      // 押す機会を持たない（trigger: tick、GameElementDefinition.md 11.1節）。ボタンに出ると
      // 「強制的に」ではなく、いつでも取れる休息が3つ増えたことになる。
      expect(
        player.instance.menuActionsFor(player.instance).map((action) => action.name),
        'ボタンには出ない',
      ).not.toContain(turnName);
    });

    it('眠る休息だけが眠気を戻す', () => {
      // 待機・休憩は起きたままなので、その間ぶんだけ覚醒度は減る（回復させるのは体力だけ）。
      expect(takeRest(character, 'wait').wakefulness).toBe(-1);
      expect(takeRest(character, 'rest').wakefulness).toBe(-4);
      expect(takeRest(character, 'nap').wakefulness).toBeGreaterThan(0);
      expect(takeRest(character, 'sleep').wakefulness).toBeGreaterThan(0);
    });

    it('長い休息ほど、1時間あたりに戻る体力が多い', () => {
      // 長さの差を効率の差として持たせている（Characters.md 休息節）。ここが単調でなくなると、
      // 細切れに休むほうが得になり、まとめて休む意味が消える。
      const perHour = RESTS.map(([actionName]) => {
        const rest = takeRest(character, actionName);
        return rest.stamina / (rest.minutes / 60);
      });

      for (let i = 1; i < perHour.length; i++) expect(perHour[i]).toBeGreaterThan(perHour[i - 1]);
    });

    it('同じ6時間なら、仮眠2回より睡眠1回のほうが多く戻る', () => {
      const nap = takeRest(character, 'nap');
      const sleep = takeRest(character, 'sleep');

      expect(nap.minutes * 2).toBe(sleep.minutes);
      expect(nap.stamina * 2, '体力').toBeLessThan(sleep.stamina);
      expect(nap.wakefulness * 2, '眠気').toBeLessThan(sleep.wakefulness);
    });

    it('睡眠1回では、覚醒度は満タンに届かない', () => {
      // 6時間眠って18時間ぶん。1日を回すだけでほぼ使い切るので、溜まった眠気は一晩では返らない。
      expect(takeRest(character, 'sleep').wakefulness).toBeLessThan(maxOf(character, 'wakefulness'));
    });

    it('絵ができるまでの代替アイコンを持つ', () => {
      // 表に無いと選択画面で全員が同じ姿になる（characterCard.ts）。
      expect(characterIcon(character)).not.toBe(characterIcon('いなくなったキャラクタ'));
    });
  });
});
