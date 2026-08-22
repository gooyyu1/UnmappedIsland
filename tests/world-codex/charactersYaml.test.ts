import { describe, expect, it } from 'vitest';
import type { ObjectDef } from '../../src/domain/ObjectDef';
import type { PropertyDef } from '../../src/domain/PropertyDef';
import { characterDefNames, resolveCharacterDefName } from '../../src/domain/generation/NewGame';
import { PlayerCharacter } from '../../src/domain/views/PlayerCharacter';
import { World } from '../../src/domain/views/World';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { characterIcon } from '../../src/game/view/characterCard';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

// describe.eachへ渡すため、beforeAllではなく読み込み時にCodexを組み立てる。
const codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
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
 * 砂浜に立たせたキャラクタ。死ぬと世界から外れる（VitalsSystem.md 6節）ので、それを見るには
 * 居場所を持たせて始める必要がある。
 */
function stand(character: string): { player: PlayerCharacter; session: WorldSession } {
  const session = new WorldSession(codex);
  const worldInstance = new WorldObject(0, def('world'), session);
  session.adoptWorld(new World(worldInstance, codex));
  const beach = session.spawn(codex.objectNames.getId('sandy_beach'));
  expect(beach.moveToSlot(worldInstance.getSlot(codex.slotNames.getId('locations')))).toBeUndefined();
  const instance = session.spawn(codex.objectNames.getId(character));
  expect(instance.moveToSlot(beach.getSlot(codex.slotNames.getId('characters')))).toBeUndefined();
  return { player: new PlayerCharacter(instance, codex), session };
}

/** 休息（docs/world/Characters.md 休息節）の4つ。長さの短い順。 */
const RESTS = [
  ['wait', 15],
  ['rest', 60],
  ['nap', 180],
  ['sleep', 360],
] as const;

/**
 * 休息を1回取ったときの、実際に戻った量。眠っている間も覚醒度は減り続けるので、覚醒度のほうは
 * 経過ぶんを差し引いた実質の回復になる。
 *
 * 頭打ちに掛かると回復量そのものを測れないため、体力は空から、覚醒度は経過ぶん（1/tick）だけ
 * 残した位置から始める。この位置なら下限でも上限でも切られない。
 */
function takeRest(
  character: string,
  actionName: string,
): { minutes: number; stamina: number; wakefulness: number } {
  const { player } = stand(character);
  const staminaId = codex.propertyNames.getId('stamina');
  const wakefulnessId = codex.propertyNames.getId('wakefulness');
  const minutes = player.instance.tryGetAction(actionName, player.instance)?.minutes() ?? 0;
  const spent = minutes / 15;

  player.instance.tryGetProperty(staminaId)?.setNumber(0);
  player.instance.tryGetProperty(wakefulnessId)?.setNumber(spent);

  expect(player.instance.tryGetAction(actionName, player.instance)?.tryExecute() === true).toBe(true);

  return {
    minutes,
    stamina: player.instance.tryGetProperty(staminaId)?.number ?? 0,
    wakefulness: (player.instance.tryGetProperty(wakefulnessId)?.number ?? 0) - spent,
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
    expect(resolveCharacterDefName(codex, characters[1])).toBe(characters[1]);
    expect(resolveCharacterDefName(codex, 'いなくなったキャラクタ')).toBe(characters[0]);
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
      ['satiety', ['status', 'nutrition']],
      ['hydration', ['status', 'nutrition']],
      ['body_fat', ['nutrition']],
      ['wakefulness', ['status', 'health']],
      ['stamina', ['status', 'health']],
      ['load', ['status', 'health']],
      ['carbohydrate', ['nutrition']],
      ['protein', ['nutrition']],
      ['lipid', ['nutrition']],
      ['vitamin', ['nutrition']],
    ])('%sを持ち、期待されるプロパティタグが付いている', (propertyName, expectedTags) => {
      const tagNames = propOf(def(character), propertyName).tags.map((id) =>
        codex.propertyTagNames.getName(id),
      );

      expect(tagNames.sort()).toEqual([...expectedTags].sort());
    });

    it('ステータスエリアに出るのは7件で、並び順も揃っている', () => {
      // propertiesWithTagの戻り順＝宣言順がそのまま画面の並びになる（StatusArea.md 3節）。
      const instance = new WorldSession(codex).spawn(def(character).globalId);
      const status = instance.propertiesWithTag(codex.propertyTagNames.getId('status'));

      expect(status.map((property) => property.def.name)).toEqual([
        'pain',
        'blood',
        'satiety',
        'hydration',
        'wakefulness',
        'stamina',
        'load',
      ]);
    });

    it.each(['pain', 'blood', 'satiety', 'hydration', 'body_fat', 'wakefulness', 'stamina', 'load'])(
      '%sは0を下限とするrangeを持つ',
      (propertyName) => {
        expect(propOf(def(character), propertyName).range?.min).toBe(0);
      },
    );

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
      // 満腹感はかさ（mL）なので、1 tickあたり16mLずつ空いていく（DigestionSystem.md 2節）。
      // ビタミンはmgで、代謝回転が1日48mg（同4節）。栄養素の在庫は減るのではなく体脂肪へ移る。
    ])('%sはtickごとに%iずつ減る', (propertyName, expectedDecay) => {
      expect(decayPerTick(character, propertyName)).toBe(expectedDecay);
    });

    it('水分は安全域のやや下、覚醒度と体力は満タン、体脂肪は最大値の1/4から始まる', () => {
      const instance = new WorldSession(codex).spawn(def(character).globalId);

      // 開始直後からステータスバーに出るよう、安全域の境目（80%）のやや下の75%から始める（Characters.md）。
      expect(
        instance.tryGetProperty(codex.propertyNames.getId('hydration'))?.number ?? 0,
        'hydration は最大値の3/4で始まる',
      ).toBe((maxOf(character, 'hydration') * 3) / 4);

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
    it.each(['hydration', 'wakefulness', 'stamina', 'blood'])(
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

    // 荷重と痛みは増える側が悪いので、境目は最大値からの割合で刻む（Characters.md）。
    it.each(['load', 'pain'])('%sの域は最大値からの割合で切られる', (propertyName) => {
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

    it.each(['load', 'pain'])('%sは増えるほど悪い値として扱われる', (propertyName) => {
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

    it('血は自分で戻り、満タンで頭打ちになる', () => {
      // 削るのは出血する怪我（injuries.yaml）だけで、戻すのは自分（Characters.md 値の刻み方節）。
      // ステータスの中でここだけが自分で増える。
      const session = new WorldSession(codex);
      const instance = new WorldObject(1, def(character), session);
      const bloodId = codex.propertyNames.getId('blood');
      const max = maxOf(character, 'blood');
      instance.tryGetProperty(bloodId)?.setNumber(max - 100);

      instance.tick();

      expect(instance.tryGetProperty(bloodId)?.number ?? 0, '1 tickで2mL戻る').toBe(max - 98);

      for (let i = 0; i < 100; i++) instance.tick();

      expect(instance.tryGetProperty(bloodId)?.number ?? 0, '満タンを超えては溜まらない').toBe(max);
    });

    it('ステータスエリアに出るもののうち、致命的域を持つのは水分と血だけ', () => {
      // 3つ目の死に方（飢え）はbody_fatが持つが、statusタグが無いのでここには現れない
      // （画面に出る飢えの兆しは満腹度、docs/world/Characters.md）。
      const instance = new WorldSession(codex).spawn(def(character).globalId);

      const fatal = instance
        .propertiesWithTag(codex.propertyTagNames.getId('status'))
        .filter((property) => property.def.alertOf(0) === 'fatal');

      expect(fatal.map((property) => property.def.name)).toEqual(['blood', 'hydration']);
    });

    // 死に方は3つだけ（VitalsSystem.md 8節）。どれも「尽きたら世界から出る」という同じ形で、
    // 死因の名前を持つのは、尽きた値が居る段（画面はその段の文言を出すだけ）。
    it.each([
      ['hydration', 'dehydrated'],
      ['body_fat', 'starved'],
      ['blood', 'exsanguinated'],
    ])('%sを使い切ると死に、死因は段「%s」になる', (propertyName, stageName) => {
      const { player } = stand(character);
      const propertyId = codex.propertyNames.getId(propertyName);

      player.instance
        .tryGetProperty(propertyId)
        ?.add(-((player.instance.tryGetProperty(propertyId)?.number ?? 0) - 1));

      expect(player.isDead, '下限に達するまでは生きている').toBe(false);
      expect(player.causeOfDeath).toBeUndefined();

      player.instance.tryGetProperty(propertyId)?.add(-1);

      expect(player.isDead, '下限に達した時点で世界から外れる').toBe(true);
      expect(player.causeOfDeath).toBe(stageName);
    });

    it.each(RESTS)('休息「%s」を持ち、%i分かかる', (actionName, minutes) => {
      const { player } = stand(character);

      expect(player.instance.tryGetAction(actionName, player.instance)?.minutes() ?? 0).toBe(minutes);
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
