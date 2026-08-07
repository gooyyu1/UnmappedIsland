import { describe, expect, it } from 'vitest';
import type { ObjectDef } from '../../src/domain/defs/ObjectDef';
import type { PropertyDef } from '../../src/domain/defs/PropertyDef';
import { characterDefNames, resolveCharacterDefName } from '../../src/domain/generation/NewGame';
import { WorldObject } from '../../src/domain/runtime/WorldObject';
import { WorldSession } from '../../src/domain/runtime/WorldSession';
import { characterIcon } from '../../src/game/ui/characterArt';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

// describe.eachへ渡すため、beforeAllではなく読み込み時にCodexを組み立てる。
const codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
const characters = characterDefNames(codex);

function def(name: string): ObjectDef {
  return codex.objects.get(codex.objectNames.getId(name));
}

function propOf(objectDef: ObjectDef, propertyName: string): PropertyDef {
  const prop = objectDef.getPropertyDef(codex.propertyNames.getId(propertyName));
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
  const before = instance.getNumber(propertyId);

  instance.tick(session);

  return before - instance.getNumber(propertyId);
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
      const hand = def(character).getSlotDef(codex.slotNames.getId('hand'));

      expect(hand, '手持ちスロットを持つ').toBeDefined();
      expect(hand?.fixedPositions, '手持ちは枠の位置が動かない固定型').toBe(true);
      expect(hand?.accepts.map((rule) => rule.targetKind)).toEqual(['tag']);
      // 枠数は個体差にしてよいが、ハンドレーンに収まる範囲に留める（ScreenLayout.md）。
      expect(hand?.unitCapacity, '手持ちは4〜8枠').toBeGreaterThanOrEqual(4);
      expect(hand?.unitCapacity, '手持ちは4〜8枠').toBeLessThanOrEqual(8);

      for (const slotName of ['equipment', 'injuries'])
        expect(
          def(character).getSlotDef(codex.slotNames.getId(slotName)),
          `${slotName} スロットを持つ`,
        ).toBeDefined();
    });

    it('装備と怪我は、中身を見せるスロットだと名乗る', () => {
      // どこに出すか（専用のボタンから開く子ウィンドウ）はUI側の決めごとで、データ側はそれに
      // 依らず「見せる」とだけ宣言する（GameElementDefinition.md 7.8節）。
      for (const slotName of ['equipment', 'injuries']) {
        const slot = def(character).getSlotDef(codex.slotNames.getId(slotName));
        expect(slot?.showsContents, `${slotName} は中身を見せる`).toBe(true);
      }
    });

    it.each([
      ['pain', ['status', 'health']],
      ['satiety', ['status', 'nutrition']],
      ['hydration', ['status', 'nutrition']],
      ['body_fat', ['nutrition']],
      ['wakefulness', ['status', 'health']],
      ['stamina', ['status', 'health']],
      ['load', ['status', 'health']],
      ['vegetable_nutrition', ['nutrition']],
      ['meat_nutrition', ['nutrition']],
      ['grain_tuber_nutrition', ['nutrition']],
    ])('%sを持ち、期待されるプロパティタグが付いている', (propertyName, expectedTags) => {
      const tagNames = propOf(def(character), propertyName).tags.map((id) =>
        codex.propertyTagNames.getName(id),
      );

      expect(tagNames.sort()).toEqual([...expectedTags].sort());
    });

    it('ステータスエリアに出るのは6件で、並び順も揃っている', () => {
      // readPropertiesWithTagの戻り順＝宣言順がそのまま画面の並びになる（ScreenLayout.md）。
      const instance = new WorldObject(1, def(character), new WorldSession(codex));
      const status = instance.readPropertiesWithTag(codex.propertyTagNames.getId('status'));

      expect(status.map((reading) => reading.name)).toEqual([
        'pain',
        'satiety',
        'hydration',
        'wakefulness',
        'stamina',
        'load',
      ]);
    });

    it.each(['pain', 'satiety', 'hydration', 'body_fat', 'wakefulness', 'stamina', 'load'])(
      '%sは0を下限とするrangeを持つ',
      (propertyName) => {
        expect(propOf(def(character), propertyName).range?.min).toBe(0);
      },
    );

    it.each([
      ['satiety', 100],
      ['body_fat', 100],
      ['wakefulness', 100],
      ['vegetable_nutrition', 100],
      ['meat_nutrition', 100],
      ['grain_tuber_nutrition', 100],
      // 水分だけは実単位のmLに載るため、1mLの意味が変わらないよう減り方に個体差を持たせない。
      ['hydration', 25],
      // 体力は行動で減るもので、時間では減らない。
      ['stamina', 0],
      // 荷重は中身から導出されるので、自分では動かない。
      ['load', 0],
      // 痛みは負っている怪我から導出されるので、自分では動かない。
      ['pain', 0],
    ])('%sはtickごとに%iずつ減る', (propertyName, expectedDecay) => {
      expect(decayPerTick(character, propertyName)).toBe(expectedDecay);
    });

    it('満腹度と水分は安全域のやや下、覚醒度と体力は満タン、体脂肪は最大値の1/4から始まる', () => {
      const instance = new WorldObject(1, def(character), new WorldSession(codex));

      // 開始直後からステータスバーに出るよう、安全域の境目（80%）のやや下の75%から始める（Characters.md）。
      for (const propertyName of ['satiety', 'hydration'])
        expect(
          instance.getNumber(codex.propertyNames.getId(propertyName)),
          `${propertyName} は最大値の3/4で始まる`,
        ).toBe((maxOf(character, propertyName) * 3) / 4);

      for (const propertyName of ['wakefulness', 'stamina'])
        expect(
          instance.getNumber(codex.propertyNames.getId(propertyName)),
          `${propertyName} は満タンで始まる`,
        ).toBe(maxOf(character, propertyName));

      // 太っても痩せてもいない標準体格の位置（Characters.md）。
      expect(instance.getNumber(codex.propertyNames.getId('body_fat'))).toBe(
        maxOf(character, 'body_fat') / 4,
      );
    });

    it.each(['satiety', 'hydration', 'wakefulness', 'stamina'])(
      '%sは最大値の80%%を下回ると安全域から外れる',
      (propertyName) => {
        // 最大値だけ変えてstagesを直し忘れると、ステータスエリアに出始める位置がずれる。
        const prop = propOf(def(character), propertyName);
        const threshold = Math.trunc(maxOf(character, propertyName) * 0.8);

        expect(prop.alertLevelOf(threshold), '80%ちょうどはまだ安全域').toBe('safe');
        expect(prop.alertLevelOf(threshold - 1)).not.toBe('safe');
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

      expect(prop.alertLevelOf(0), '0は安全域').toBe('safe');
      expect(prop.alertLevelOf(Math.trunc(max / 4)), '1/4で留意域').toBe('watch');
      expect(prop.alertLevelOf(Math.trunc(max / 2)), '1/2で要注意域').toBe('caution');
      expect(prop.alertLevelOf(Math.trunc((max * 5) / 6)), '5/6で危険域').toBe('danger');
    });

    it('荷重の危険域の段だけがtoo_heavyという名前を持つ', () => {
      // 道のtravelがこの名前で見る（locations.yaml・ContainerSystem.md 5節）。
      const prop = propOf(def(character), 'load');
      const threshold = (maxOf(character, 'load') * 5) / 6;

      expect(prop.isInStage(threshold, 'too_heavy')).toBe(true);
      expect(prop.isInStage(threshold - 1, 'too_heavy')).toBe(false);
    });

    it.each(['load', 'pain'])('%sは増えるほど悪い値として扱われる', (propertyName) => {
      // バーの向きと増減の記号の色が反転する（ScreenLayout.md ステータスエリア節）。
      expect(propOf(def(character), propertyName).worsensUpward).toBe(true);
      expect(propOf(def(character), 'stamina').worsensUpward).toBe(false);
    });

    // 最大値が違っても「あと何時間で赤くなるか」は揃える（Characters.md）。1時間 = 4 tick。
    it.each(['satiety', 'wakefulness'])('%sの域は残り時間で切られる', (propertyName) => {
      const prop = propOf(def(character), propertyName);
      const perHour = decayPerTick(character, propertyName) * 4;

      expect(prop.alertLevelOf(perHour * 3), '残り3時間').toBe('caution');
      expect(prop.alertLevelOf(perHour * 3 - 1)).toBe('danger');
      expect(prop.alertLevelOf(perHour * 12), '残り12時間').toBe('watch');
      expect(prop.alertLevelOf(perHour * 12 - 1)).toBe('caution');
    });

    it('水分の域は残り時間で切られ、尽きると致命的域に入る', () => {
      const prop = propOf(def(character), 'hydration');
      const perHour = decayPerTick(character, 'hydration') * 4;

      expect(prop.alertLevelOf(perHour * 6), '残り6時間').toBe('danger');
      expect(prop.alertLevelOf(perHour * 6 - 1)).toBe('fatal');
      expect(prop.alertLevelOf(perHour * 24), '残り1日').toBe('caution');
      expect(prop.alertLevelOf(perHour * 24 - 1)).toBe('danger');
      expect(prop.alertLevelOf(perHour * 48), '残り2日').toBe('watch');
      expect(prop.alertLevelOf(perHour * 48 - 1)).toBe('caution');
    });

    it('体力の域は最大値に対する割合で切られる', () => {
      // tickで減らないため、残り時間では切れない（Characters.md）。
      const prop = propOf(def(character), 'stamina');
      const max = maxOf(character, 'stamina');

      expect(prop.alertLevelOf(Math.trunc(max * 0.6))).toBe('watch');
      expect(prop.alertLevelOf(Math.trunc(max * 0.6) - 1)).toBe('caution');
      expect(prop.alertLevelOf(Math.trunc(max * 0.2))).toBe('caution');
      expect(prop.alertLevelOf(Math.trunc(max * 0.2) - 1)).toBe('danger');
    });

    it('致命的域を持つのは、放置すると死に至る水分だけ', () => {
      const instance = new WorldObject(1, def(character), new WorldSession(codex));

      const fatal = instance
        .readPropertiesWithTag(codex.propertyTagNames.getId('status'))
        .filter((reading) => propOf(def(character), reading.name).alertLevelOf(0) === 'fatal');

      expect(fatal.map((reading) => reading.name)).toEqual(['hydration']);
    });

    it('絵ができるまでの代替アイコンを持つ', () => {
      // 表に無いと選択画面で全員が同じ姿になる（characterArt.ts）。
      expect(characterIcon(character)).not.toBe(characterIcon('いなくなったキャラクタ'));
    });
  });
});
