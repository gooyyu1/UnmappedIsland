import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PropertyValue } from '../../src/domain/PropertyValue';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { bundledCodex, SAMPLE_CHARACTER } from '../support/worldCodexFiles';

/**
 * 食中毒（docs/engine/DigestionSystem.md 6節）を、実ファイルの定義だけで検証する。
 *
 * **見るのは「同じ生肉を食べても、体の側で結果が分かれること」**——免疫が足りていれば症状の出る段へ
 * 届かないまま消え、足りなければ段を上げて既存の死に方へ流れる。抽選を1つも引かないので、どちらの
 * 筋書きも乱数を置かずにそのまま辿れる。
 */
describe('全身の菌と免疫', () => {
  /** 1日 = 96 tick（1 tick = 15分）。 */
  const DAY = 96;
  /** 生肉1切れが運ぶ菌（animals.yamlのraw_meatのeat）。 */
  const ONE_RAW_MEAL = 3;

  let codex: WorldCodex;
  let session: WorldSession;
  let player: WorldObject;

  beforeAll(() => {
    codex = bundledCodex();
  });

  beforeEach(() => {
    const worldInstance = new WorldObject(
      0,
      codex.objects.get(codex.objectNames.getId('world')),
      new WorldSession(codex),
    );
    session = new WorldSession(codex);
    const beach = spawn('sandy_beach');
    expect(
      beach.moveToSlotOrRejection(worldInstance.getSlot(codex.slotNames.getId('locations'))),
    ).toBeUndefined();
    player = spawn(SAMPLE_CHARACTER);
    expect(player.moveToSlotOrRejection(beach.getSlot(codex.slotNames.getId('characters')))).toBeUndefined();
  });

  function spawn(objectName: string): WorldObject {
    return session.createObject(codex.objectNames.getId(objectName));
  }

  function prop(name: string): PropertyValue {
    return player.getProperty(codex.propertyNames.getId(name));
  }

  /**
   * count tickぶん進める。**免疫を押し下げる側の値は、tickの前の値に留め置く**——渇き・飢え・眠気は
   * 放っておけば勝手に進むので、留めないと「何日目にどの押し下げが加わったか」で結果が変わる。
   * 押し下げを効かせたいときは、呼ぶ前にその値を0にしておけばその値に留まる。
   */
  function live(
    count: number,
    held: readonly string[] = ['hydration', 'body_fat', 'satiety', 'wakefulness', 'vitamin'],
  ): void {
    for (let i = 0; i < count; i++) {
      const kept = held.map((name) => [name, prop(name).number] as const);
      player.tick();
      if (player.parent === undefined) return;
      for (const [name, value] of kept) prop(name).setNumberWithoutEvents(value);
    }
  }

  /** 生肉を1切れ食べる。 */
  function eatRawMeat(): void {
    const meat = spawn('raw_meat');
    expect(meat.moveToSlotOrRejection(player.getSlot(codex.slotNames.getId('hand')))).toBeUndefined();

    expect(meat.tryGetAction('eat', player)?.tryExecute() === true).toBe(true);
  }

  it('採れたての生肉でも、口にすれば菌が入る', () => {
    // 腐敗とは独立している（DigestionSystem.md 6節）。傷んでいない生肉で何も起きないことが、
    // 抽選で塞ごうとしたときに残っていた穴（#1146・#1325）。
    expect(prop('pathogen').number, '食べる前は無菌').toBe(0);

    eatRawMeat();

    expect(prop('pathogen').number).toBe(ONE_RAW_MEAL);
    expect(prop('pathogen').stage?.name, '入っただけでは、まだ症状の段に届かない').toBe('latent');
    expect(prop('pathogen').alert, '潜伏期は見えない（StatusArea.md 3節）').toBe('safe');
  });

  it('焼いた肉には菌が無い', () => {
    // 火を通す価値がここに出る。焼いた肉は菌を名乗らないので、食べても0のまま。
    const roasted = spawn('roasted_meat');
    expect(roasted.moveToSlotOrRejection(player.getSlot(codex.slotNames.getId('hand')))).toBeUndefined();

    expect(roasted.tryGetAction('eat', player)?.tryExecute() === true).toBe(true);

    expect(prop('pathogen').number).toBe(0);
  });

  it('免疫が足りていれば、症状が出ないまま0へ戻る', () => {
    // 除去（robustの0.2）が増殖（0.15）を上回るので、正味-0.05/tickで引いていく。
    expect(prop('immunity').getEffectiveValue(), '健康な体は生来の高さから始まる').toBe(60);
    expect(prop('immunity').stage?.name).toBe('robust');

    eatRawMeat();

    live(1);
    expect(prop('pathogen').number, '増殖と除去の差だけ減る').toBeCloseTo(ONE_RAW_MEAL - 0.05, 5);

    live(DAY);
    expect(prop('pathogen').number, '1日のうちに消える').toBe(0);
    expect(prop('pathogen').stage?.name).toBe('sterile');
    expect(prop('pathogen').alert, '症状の段へは一度も上がらないので、画面に行も出ない').toBe('safe');
  });

  it('菌が消えれば増殖も止まり、免疫も上がらなくなる', () => {
    // 最下段に増殖を置かないこと（log₁₀ 0 は菌1個であって菌ゼロではない）の検証。怠ると、何も
    // 口にしていない体で菌が増え始める。
    live(DAY);

    expect(prop('pathogen').number, '何も口にしなければ菌は増えない').toBe(0);
    expect(prop('immunity').number, '感染していなければ免疫も動かない').toBe(60);
  });

  it('押し下げが2つ重なると、同じ1切れで熱が出る', () => {
    // 空腹（-20）と寝不足（-15）でweakenedへ落ちると、除去（0.1）が増殖（0.15）を下回るので、
    // 同じ量の菌が減らずに増える。**1つだけではrobustに留まる**のが段の置き方（player_character.yaml）。
    prop('satiety').setNumberWithoutEvents(0);
    prop('wakefulness').setNumberWithoutEvents(0);
    expect(prop('immunity').getEffectiveValue(), '2つぶん下がる').toBe(25);
    expect(prop('immunity').stage?.name).toBe('weakened');

    eatRawMeat();
    prop('satiety').setNumberWithoutEvents(0);

    live(50);

    expect(prop('pathogen').number, '正味+0.05/tickで増える').toBeGreaterThan(ONE_RAW_MEAL);
    expect(prop('pathogen').stage?.name, '発症する').toBe('feverish');
    expect(prop('pathogen').alert).toBe('caution');

    // 熱のぶんは水の減りとして出る（VitalsSystem.md 8.1節）。素の-1に段の-1が重なって倍になる。
    const water = prop('hydration').number;
    live(1, ['body_fat', 'satiety', 'wakefulness', 'vitamin']);
    expect(water - prop('hydration').number, '熱で水の保ちが半分になる').toBe(2);
  });

  it('感染しているあいだに免疫が上がり、追いついたところで引き始める', () => {
    // 潜伏期＝免疫が段を1つ上げるのに要る時間（+0.25/tickで、weakenedの下端25からrobustの40まで
    // 60 tick）。別の仕組みを足さずに、獲得免疫と「免疫が反応するまでの時間差」の両方をこれで表す。
    prop('satiety').setNumberWithoutEvents(0);
    prop('wakefulness').setNumberWithoutEvents(0);
    eatRawMeat();
    prop('satiety').setNumberWithoutEvents(0);

    live(59);
    expect(prop('immunity').stage?.name, '59 tickではまだ届かない').toBe('weakened');
    const beforeCatchingUp = prop('pathogen').number;

    live(1);
    expect(prop('immunity').stage?.name, '60 tick目に段が上がる').toBe('robust');
    const peak = prop('pathogen').number;
    expect(peak, 'その回まではまだ増えている').toBeGreaterThan(beforeCatchingUp);

    live(1);
    expect(prop('pathogen').number, '段が上がった次の回から減りに転じる').toBeLessThan(peak);
  });

  it('罹って治った体は、生来より高いところで止まる', () => {
    // 獲得免疫。いちばん上の段（primed）だけが自分を引き戻すので、上げた分は使い切られずに残る。
    // 押し下げ2つ（惨め-10と寝不足-15）を当てて、罹る前と後で段が変わることを見る。
    prop('happiness').setNumberWithoutEvents(0);
    prop('wakefulness').setNumberWithoutEvents(0);
    expect(prop('immunity').stage?.name, '生来の60では、2つ重なると落ちる').toBe('weakened');
    prop('happiness').setNumberWithoutEvents(75);
    prop('wakefulness').setNumberWithoutEvents(192);

    eatRawMeat();
    live(10 * DAY);

    expect(prop('pathogen').number, '感染は収まっている').toBe(0);
    expect(prop('immunity').number, '生来の60より高い').toBeGreaterThan(60);
    expect(prop('immunity').number, 'いちばん上の段を抜けたところで止まる').toBeLessThan(70);

    prop('happiness').setNumberWithoutEvents(0);
    prop('wakefulness').setNumberWithoutEvents(0);
    expect(prop('immunity').stage?.name, '同じ-25を抱えても、今度は段を保てる').toBe('robust');
  });

  it('免疫が届かないまま放置すれば、既存の死に方で死ぬ', () => {
    // 死に方は増えない（VitalsSystem.md 8節）。上の段が削るのは血なので、名乗りは失血のまま。
    // 壊血病（-40）と空腹（-20）を抱えたままでは除去がfailingの0.05まで落ち、菌は上限へ暴走する。
    prop('vitamin').setNumberWithoutEvents(0);
    prop('satiety').setNumberWithoutEvents(0);
    expect(prop('immunity').getEffectiveValue(), '生来の免疫より下へは行かない').toBe(20);
    expect(prop('immunity').stage?.name).toBe('failing');

    eatRawMeat();
    prop('satiety').setNumberWithoutEvents(0);

    live(3 * DAY);

    expect(player.parent, '3日のうちに死ぬ').toBeUndefined();
    expect(player.destroyedReason, '終わり方は失血のまま').toBe('exsanguinated');
  });

  it('獣も同じ物差しで菌を持つが、免疫は動かない', () => {
    // 深手を負った獣が敗血症で死ぬ経路（傷から繋ぐのは次のissue）の受け皿。生活で上下しないので
    // 段は1つで、人の健康時と同じ高さに置いてある。
    const boar = spawn('wild_boar');
    const pathogen = boar.getProperty(codex.propertyNames.getId('pathogen'));
    const immunity = boar.getProperty(codex.propertyNames.getId('immunity'));

    expect(pathogen.def.range?.max, '人と同じ物差し（log₁₀ CFU）').toBe(9);
    expect(immunity.stage?.name).toBe('robust');

    pathogen.setNumberWithoutEvents(ONE_RAW_MEAL);
    boar.tick();

    expect(pathogen.number, '人と同じ速さで引く').toBeCloseTo(ONE_RAW_MEAL - 0.05, 5);
    expect(immunity.number, '感染しても上がらない').toBe(60);
  });
});
