import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { putIntoSlot } from '../../src/domain/slotEntry';
import { PlayerCharacter } from '../../src/domain/wrappers/PlayerCharacter';
import { World } from '../../src/domain/wrappers/World';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { fixedRng } from '../support/rng';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';
import { makeBrightEnoughForAnyAction } from '../support/illumination';

/**
 * injuries.yamlの怪我を、実ファイルの定義だけで検証する（docs/engine/InjurySystem.md）。
 * 負う契機（ヤシの木からの落下）・痛みへの影響・時間で治ることの3つを通す。
 */
describe('injuries.yamlの怪我', () => {
  /** pick_green_coconutで捻挫する側を引く重みの位置（成功90 : 失敗10）。 */
  const FALLS = 0.95;
  /** 捻挫が治りきるまでのtick数（severity 960 ÷ 1）。 */
  const HEALING_TICKS = 960;

  let codex: WorldCodex;
  let session: WorldSession;
  let beach: WorldObject;
  let player: WorldObject;
  let painId: number;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
    painId = codex.propertyNames.getId('pain');
  });

  beforeEach(() => {
    open(FALLS);
  });

  /** 砂浜に立つプレイヤーから始める。rollはpickがどの候補を引くかを決める（fixedRng）。 */
  function open(roll: number): void {
    const worldInstance = new WorldObject(
      0,
      codex.objects.get(codex.objectNames.getId('world')),
      new WorldSession(codex),
    );
    session = new WorldSession(codex, new World(worldInstance, codex), fixedRng(roll));
    beach = spawnInto('sandy_beach', worldInstance, 'locations');
    player = spawnInto(SAMPLE_CHARACTER, beach, 'characters');
    // 怪我を負う実採り（coconut.yaml）は明るさを要求する（IlluminationSystem.md 5節）。ここで
    // 見たいのは怪我なので、時刻や光源を組み立てずに作業者の側で明るさを満たす。
    makeBrightEnoughForAnyAction(player, codex);
  }

  function spawnInto(objectName: string, parent: WorldObject, slotName: string): WorldObject {
    const spawned = session.createObject(codex.objectNames.getId(objectName));
    expect(spawned.moveToSlotOrRejection(parent.getSlot(codex.slotNames.getId(slotName)))).toBeUndefined();
    return spawned;
  }

  /** 手持ちに並ぶ物の識別子（同種のスタックは個数ぶん並べる）。 */
  function handOf(character: WorldObject): string[] {
    return new PlayerCharacter(character, codex).handStacks.flatMap((stack) =>
      stack.map((object) => object.def.name),
    );
  }

  /** 怪我スロットに並ぶ物の識別子（同種のスタックは個数ぶん並べる）。 */
  function injuriesOf(character: WorldObject): string[] {
    return new PlayerCharacter(character, codex).injuryStacks.flatMap((stack) =>
      stack.map((object) => object.def.name),
    );
  }

  /** その怪我に当たっている治療具の識別子（当てていなければ空）。 */
  function treatmentOn(injury: WorldObject): string[] {
    const slot = injury.tryGetSlot(codex.slotNames.getId('treatment'));
    return slot === undefined ? [] : slot.contents.map((object) => object.def.name);
  }

  /** 治療具を当てる。画面のドロップと同じ経路（枠が時間を課すので、そこを通さないと値段を払わない）。 */
  function treat(injury: WorldObject, treatment: WorldObject): void {
    const slot = injury.getSlot(codex.slotNames.getId('treatment'));
    putIntoSlot(treatment, slot, player, session, () => {
      treatment.moveToSlotOrRejection(slot);
    });
  }

  /** 当てていた治療具を外して手元へ戻す。 */
  function removeTreatment(treatment: WorldObject): void {
    expect(treatment.moveToSlotOrRejection(player.getSlot(codex.slotNames.getId('hand')))).toBeUndefined();
  }

  /** 骨折を1つ負う。刺す口は大型の獣の1手（animals.yaml、tests/world-codex/animalTurn.test.ts）。 */
  function breakBone(): WorldObject {
    return spawnInto('fracture', player, 'injuries');
  }

  /** 荷重（load）のプロパティ番号。 */
  function loadId(): number {
    return codex.propertyNames.getId('load');
  }

  /** ヤシの実を採ろうとする。成否はopenへ渡したrollで決まっている。 */
  function pickCoconut(): void {
    const tree = spawnInto('palm_tree', beach, 'fixtures');
    expect(tree.tryGetAction('pick_green_coconut', player)?.tryExecute() === true).toBe(true);
  }

  /**
   * count tickぶん時間を進める。怪我が治りきるには10日かかるので、その間に渇きと飢えで死んで
   * しまわないよう（VitalsSystem.md 8節）、命を絶つ値だけは減った分を戻しておく。ここで見たいのは
   * 傷の治りだけで、生き延びる手立ては別のテストが持つ。
   *
   * **脂の在庫も戻す。** 15時間で尽きて段が痛みを押し上げる（DigestionSystem.md 7節）ので、
   * そのままでは怪我の痛みだけを見ていられなくなる。
   *
   * **眠気と幸福度も同じ理由で戻す。** 尽きると次の操作の切れ目で強制的に時間が進む
   * （docs/world/Characters.md 限界節）ので、そのままでは洗った1杯ぶんの効き目が測れない。
   */
  function tick(count: number): void {
    const vital = ['hydration', 'body_fat', 'lipid', 'wakefulness', 'happiness'].map((name) =>
      codex.propertyNames.getId(name),
    );
    const held = vital.map((id) => player.tryGetProperty(id)?.number ?? 0);
    for (let i = 0; i < count; i++) {
      player.tick();
      vital.forEach((id, index) => player.getProperty(id).setNumberWithoutEvents(held[index]));
    }
  }

  it('実採りに失敗すると、実は採れず足首を捻挫する', () => {
    pickCoconut();

    expect(injuriesOf(player)).toEqual(['sprained_ankle']);
    expect(new PlayerCharacter(player, codex).hand.filter((cell) => cell !== undefined)).toEqual([]);
  });

  it('実採りに成功した回は怪我をしない', () => {
    open(0);

    pickCoconut();

    expect(injuriesOf(player)).toEqual([]);
    expect(player.tryGetProperty(painId)?.getEffectiveValue() ?? 0).toBe(0);
  });

  it('怪我は痛みを押し上げ、重なるほど強くなる', () => {
    expect(player.tryGetProperty(painId)?.getEffectiveValue() ?? 0, '無傷なら痛みは無い').toBe(0);

    pickCoconut();
    expect(player.tryGetProperty(painId)?.getEffectiveValue() ?? 0).toBe(40);

    pickCoconut();
    expect(injuriesOf(player), '同じ怪我でも2つぶん負う').toEqual(['sprained_ankle', 'sprained_ankle']);
    expect(player.tryGetProperty(painId)?.getEffectiveValue() ?? 0, 'modifyは単純加算される（8.3節）').toBe(
      80,
    );
  });

  it('痛みは怪我が治るまで残り、治れば引く', () => {
    pickCoconut();

    tick(HEALING_TICKS - 1);
    expect(injuriesOf(player), '治りきる手前ではまだ残っている').toEqual(['sprained_ankle']);
    expect(player.tryGetProperty(painId)?.getEffectiveValue() ?? 0).toBe(40);

    tick(1);
    expect(injuriesOf(player), '傷が尽きた瞬間に消える').toEqual([]);
    expect(player.tryGetProperty(painId)?.getEffectiveValue() ?? 0, '可逆な寄与なので痛みも消える').toBe(0);
  });

  it('怪我は負った本人から離せない', () => {
    // bound_to_owner（7.9節）。身体から離れた「捻挫」は存在しないので、どこへも移せない
    // ——手持ちや足元がinjuryタグを弾くからではなく、その物がそう在れないから。
    pickCoconut();
    const injury = new PlayerCharacter(player, codex).injuryStacks[0][0];

    expect(injury.moveToSlotOrRejection(beach.getSlot(codex.slotNames.getId('items')))).toContain(
      '離せません',
    );
    // 同じ本人の中でも手持ちへは移らない。こちらを弾くのはhandのaccepts（itemのみ）。
    expect(injury.moveToSlotOrRejection(player.getSlot(codex.slotNames.getId('hand')))).toBeDefined();
    expect(injuriesOf(player), '弾かれた側は怪我スロットに残る').toEqual(['sprained_ankle']);
  });

  it('傷の重さは道具の耐久度と別のプロパティで、引くほど軽い域へ移る', () => {
    // 耐久値は多いほど良い量、傷は多いほど悪い量なので、同じ語彙には載せない（InjurySystem.md 2節）。
    pickCoconut();
    const injury = new PlayerCharacter(player, codex).injuryStacks[0][0];

    expect(injury.tryGetProperty(codex.propertyNames.getId('durability'))).toBeUndefined();

    const severityId = codex.propertyNames.getId('severity');
    expect(injury.tryGetProperty(severityId)?.alert, '負った直後は要注意域').toBe('caution');
    expect(injury.tryGetProperty(severityId)?.def.worsensUpward, '増えるほど悪い').toBe(true);

    tick(HEALING_TICKS / 2);

    expect(injury.tryGetProperty(severityId)?.alert, '半分治れば留意域').toBe('watch');
    expect(injury.tryGetProperty(severityId)?.ratio).toBeCloseTo(0.5, 2);
  });

  /**
   * 痛みの重さと治る長さの並び（InjurySystem.md 2節）。**2つを揃えないと決めたうえでの並び**なので、
   * 逆転して見える組（捻挫と刺し傷）が意図どおりであることも、ここが持つ。
   */
  describe('痛みと治る長さの並び', () => {
    /** 関節と骨の傷。塞がって終わらないので、皮膚と肉の傷の並びには乗らない（InjurySystem.md 2節）。 */
    const SUPPORT_TISSUE = ['sprained_ankle', 'fracture'];

    interface Reading {
      name: string;
      /** その傷を1つ負ったときの痛み。 */
      pain: number;
      /** 最も長く残る場合の傷の重さ。ロールで振れる傷はその上端（DurationStats.md）。 */
      longest: number;
    }

    function reading(name: string): Reading {
      open(FALLS);
      spawnInto(name, player, 'injuries');
      const def = codex.objects.get(codex.objectNames.getId(name));
      return {
        name,
        pain: player.tryGetProperty(painId)?.getEffectiveValue() ?? 0,
        longest: def.tryGetPropertyDef(codex.propertyNames.getId('severity'))?.range?.max ?? 0,
      };
    }

    function readings(): Reading[] {
      return codex.objectDefNamesWithTag(codex.tagNames.getId('injury')).map(reading);
    }

    function skinAndFlesh(all: Reading[]): Reading[] {
      return all.filter((one) => !SUPPORT_TISSUE.includes(one.name));
    }

    it('皮膚と肉の傷は、痛みが重いほど長く残り、痛みが同じなら長さも同じ', () => {
      const skin = skinAndFlesh(readings());
      expect(skin.length, '検査対象が無い（injuryタグが変わっていないか）').toBeGreaterThan(1);

      for (const a of skin) {
        for (const b of skin) {
          if (a.pain < b.pain) {
            expect(a.longest, `${a.name}は${b.name}より痛みが軽い`).toBeLessThan(b.longest);
          } else if (a.pain === b.pain) {
            expect(a.longest, `${a.name}と${b.name}は痛みが同じ`).toBe(b.longest);
          }
        }
      }
    });

    it('関節と骨の傷は、どの皮膚の傷よりも長く残る', () => {
      const all = readings();
      const support = all.filter((one) => SUPPORT_TISSUE.includes(one.name));
      expect(support, '関節と骨の傷が見当たらない').toHaveLength(SUPPORT_TISSUE.length);

      const skinLongest = Math.max(...skinAndFlesh(all).map((one) => one.longest));
      for (const one of support) {
        expect(one.longest, `${one.name}が皮膚の傷の並びに埋もれている`).toBeGreaterThan(skinLongest);
      }
    });

    it('捻挫は、刺し傷より痛くないのに長く残る', () => {
      const sprain = reading('sprained_ankle');
      const puncture = reading('puncture_wound');

      expect(sprain.pain).toBeLessThan(puncture.pain);
      expect(sprain.longest, '痛みと長さを揃えないことの現れ').toBeGreaterThan(puncture.longest);
    });
  });

  describe('手当て', () => {
    /** 捻挫を1つ負い、その怪我と、手持ちに持たせた包帯を返す。 */
    function injured(): { injury: WorldObject; bandage: WorldObject } {
      pickCoconut();
      const injury = new PlayerCharacter(player, codex).injuryStacks[0][0];
      return { injury, bandage: spawnInto('bandage', player, 'hand') };
    }

    it('包帯を怪我へ重ねると、その怪我に当たった状態になる', () => {
      const { injury, bandage } = injured();

      treat(injury, bandage);

      expect(treatmentOn(injury)).toEqual(['bandage']);
      expect(bandage.parent, '手持ちから怪我の中へ移る').toBe(injury);
    });

    it('当てられるのは1つだけ', () => {
      const { injury, bandage } = injured();
      treat(injury, bandage);
      const second = spawnInto('bandage', player, 'hand');
      const before = session.world!.totalMinutes;

      treat(injury, second);

      expect(treatmentOn(injury), '2つめは入らない').toEqual(['bandage']);
      expect(second.parent, '入らなかった治療具は手元に残る').toBe(player);
      expect(session.world!.totalMinutes, '入らないと分かっているので時間も取らない').toBe(before);
    });

    it('同じ怪我を2つ負っても束ならず、1つずつ手当てする', () => {
      // stackable: false（SlotSystem.md 4節）。束ねてしまうと代表の1つにしか治療具を当てられない。
      const { injury, bandage } = injured();
      pickCoconut();
      const stacks = new PlayerCharacter(player, codex).injuryStacks;
      expect(
        stacks.map((stack) => stack.length),
        '2つの枠に1つずつ並ぶ',
      ).toEqual([1, 1]);

      treat(injury, bandage);

      expect(treatmentOn(injury)).toEqual(['bandage']);
      const untouched = stacks.flat().find((object) => object !== injury)!;
      expect(treatmentOn(untouched), 'もう一方は手当てされないまま残る').toEqual([]);
    });

    it('当てるのに30分かかり、外すのは一瞬', () => {
      const { injury, bandage } = injured();
      const before = session.world!.totalMinutes;

      treat(injury, bandage);

      expect(session.world!.totalMinutes - before, '当てるのに30分').toBe(30);
      const applied = session.world!.totalMinutes;

      bandage.moveToSlotOrRejection(player.getSlot(codex.slotNames.getId('hand')));

      expect(session.world!.totalMinutes, '外すのは一瞬').toBe(applied);
    });

    it('治療具でない物は当てられない', () => {
      const { injury } = injured();
      const stone = spawnInto('stone', player, 'hand');

      expect(stone.moveToSlotOrRejection(injury.getSlot(codex.slotNames.getId('treatment')))).toBeDefined();
      expect(treatmentOn(injury)).toEqual([]);
    });

    it('包帯を当てている間は、治りが速くなり痛みも減る', () => {
      const { injury, bandage } = injured();
      const severityId = codex.propertyNames.getId('severity');
      expect(player.tryGetProperty(painId)?.getEffectiveValue() ?? 0).toBe(40);

      treat(injury, bandage);
      // 当て終わるまでの30分は当たっていないので、そこは効き目の外。数えるのは当ててからの分。
      const before = injury.tryGetProperty(severityId)?.number ?? 0;

      expect(player.tryGetProperty(painId)?.getEffectiveValue() ?? 0, '当てている間だけ痛みが引く').toBe(30);
      tick(10);
      // 自然治癒の-1/tickに、包帯の-0.4/tickが重なる（8.4節）。
      expect(before - (injury.tryGetProperty(severityId)?.number ?? 0)).toBeCloseTo(1.4 * 10, 10);
    });

    it('外せば効き目も消える', () => {
      const { injury, bandage } = injured();
      treat(injury, bandage);

      removeTreatment(bandage);

      expect(player.tryGetProperty(painId)?.getEffectiveValue() ?? 0, '可逆な寄与なので戻る').toBe(40);
      const severityId = codex.propertyNames.getId('severity');
      const before = injury.tryGetProperty(severityId)?.number ?? 0;
      tick(10);
      expect(before - (injury.tryGetProperty(severityId)?.number ?? 0), '治りの速さも元へ戻る').toBe(1 * 10);
    });

    it('手持ちに入れているだけの治療具は効かない', () => {
      // ancestorはスロットを問わず祖先を辿るので、conditionsで当てている間に絞っている。
      pickCoconut();
      spawnInto('bandage', player, 'hand');

      expect(player.tryGetProperty(painId)?.getEffectiveValue() ?? 0).toBe(40);
    });

    it('怪我が治れば、当てていた治療具はこぼれ出る', () => {
      // 治った怪我はdestroyされるが、包帯は単独で在れるので道連れにならず、怪我の親——つまり
      // 負っていた本人——へこぼれ出る（GameElementDefinition.md 7.9節）。
      const { injury, bandage } = injured();
      treat(injury, bandage);

      tick(HEALING_TICKS);

      expect(injuriesOf(player)).toEqual([]);
      expect(injury.parent, '怪我は世界から外れる').toBeUndefined();
      expect(bandage.parent, '包帯は本人の手元へ戻る').toBe(player);
      expect(handOf(player)).toEqual(['bandage']);
    });
  });

  /**
   * 膿んだ傷を洗う（docs/engine/InjurySystem.md 6節）。**上げる側と下げる側の両方**を通す
   * ——下げる手立てだけがあっても、上がる道が無ければ数字は動かない。
   */
  describe('傷を洗う', () => {
    /** infectionが1段上がるのにかかるtick数（0.25/tick で 40）。 */
    const TO_FESTERING = 160;
    /** cleanからsepticへ届くまでのtick数。 */
    const TO_SEPTIC = 320;

    const infectionId = () => codex.propertyNames.getId('infection');

    /** 皮膚の破れた傷を1つ負う。刺す口は動物の1手と罠（animals.yaml・traps.yaml）。 */
    function openWound(name = 'laceration'): WorldObject {
      return spawnInto(name, player, 'injuries');
    }

    /** 中身を満たした器を手持ちに用意する。 */
    function filledJar(content = 'water', milliliters = 4000): WorldObject {
      const jar = spawnInto(`jar__content_${content}_liquid`, player, 'hand');
      jar.tryGetProperty(codex.propertyNames.getId('fill'))!.setNumber(milliliters);
      return jar;
    }

    /** 器を傷へ重ねる操作（成立していなければ、断る側の組み合わせが返る）。 */
    function washing(injury: WorldObject, vessel: WorldObject) {
      return (
        injury.combinationsWith(vessel, player).find((one) => one.name === 'wash') ??
        injury.refusedCombinationsWith(vessel, player).find((one) => one.name === 'wash')
      );
    }

    function infectionOf(injury: WorldObject): number {
      return injury.tryGetProperty(infectionId())?.number ?? 0;
    }

    it('膿むのは皮膚が破れた傷だけで、洗えるのもその傷だけ', () => {
      // bleedingを持つ傷とinfectionを持つ傷が一致していること（InjurySystem.md 6節）。皮膚の下で
      // 起きる傷には、汚れの入る傷口も水の届く傷口も無い。**傷が増えるたびに配り忘れる**ので、
      // 一覧を数え上げずに、2つのプロパティの有無が揃っていることで見る。
      const bleedingId = codex.propertyNames.getId('bleeding');
      const injuries = codex.objectDefNamesWithTag(codex.tagNames.getId('injury'));
      expect(injuries.length, '検査対象が無い（injuryタグが変わっていないか）').toBeGreaterThan(1);

      const mismatched = injuries.filter((name) => {
        const def = codex.objects.get(codex.objectNames.getId(name));
        return (
          (def.tryGetPropertyDef(bleedingId) !== undefined) !==
          (def.tryGetPropertyDef(infectionId()) !== undefined)
        );
      });

      expect(mismatched, 'bleedingとinfectionの配りが食い違っている').toEqual([]);
      expect(washing(breakBone(), filledJar()), '皮膚の下の傷には水を掛けられない').toBeUndefined();
    });

    it('開いた傷のカードには、傷の重さと膿み具合の2本が並ぶ', () => {
      // gaugeを2つ宣言した物は2本出る（CardView.md 8節）。**画面側に対応表は無い**ので、
      // 増えた宣言がそのままカードの見た目になる。並ぶ順は宣言順で、traitが配るinfectionが
      // 傷ごとのseverityより先に来る。
      expect(
        openWound()
          .gaugeProperties()
          .map((property) => property.def.name),
      ).toEqual(['infection', 'severity']);
      expect(
        breakBone()
          .gaugeProperties()
          .map((property) => property.def.name),
        '骨折は1本のまま',
      ).toEqual(['severity']);
    });

    it('開いたままの傷は、放っておくと膿んでいく', () => {
      const injury = openWound();
      expect(infectionOf(injury), '負った瞬間は清潔').toBe(0);

      tick(4);
      expect(infectionOf(injury), '1時間で1').toBeCloseTo(1, 10);

      tick(TO_FESTERING - 4);
      expect(injury.tryGetProperty(infectionId())?.stage?.name).toBe('festering');

      tick(TO_SEPTIC - TO_FESTERING);
      expect(injury.tryGetProperty(infectionId())?.stage?.name).toBe('septic');
    });

    it('水を1杯掛けると25落ち、その1杯は器から消える', () => {
      const injury = openWound();
      tick(TO_SEPTIC);
      const jar = filledJar();
      // 開けた器は置いておくだけでも蒸発する（liquid_containers.yaml）ので、掛けた量は
      // 洗わなかった器との差で見る。
      const idle = filledJar();
      const fillId = codex.propertyNames.getId('fill');
      const before = { infection: infectionOf(injury), minutes: session.world!.totalMinutes };

      expect(washing(injury, jar)?.tryExecute()).toBe(true);

      // 洗っている15分（＝1 tick）ぶんは汚れも進むので、正味で落ちるのは25から0.25引いた分。
      expect(before.infection - infectionOf(injury), '1杯で25').toBeCloseTo(25 - 0.25, 10);
      expect(
        idle.tryGetProperty(fillId)!.number - jar.tryGetProperty(fillId)!.number,
        '掛けた1杯は器へ戻らない',
      ).toBe(250);
      expect(session.world!.totalMinutes - before.minutes, '治療具を当てる30分の半分').toBe(15);
    });

    it('沸かした湯でも同じだけ落ちる', () => {
      // 落とすのは傷口に入った汚れなので、沸かしてあるかどうかは効き目を変えない
      // （両方がcleansingを名乗る、liquid_containers.yaml）。
      const injury = openWound();
      tick(TO_SEPTIC);
      const before = infectionOf(injury);

      expect(washing(injury, filledJar('hot_water'))?.tryExecute()).toBe(true);

      expect(before - infectionOf(injury)).toBeCloseTo(25 - 0.25, 10);
    });

    it('最も膿んだ状態からでも4杯で落とし切れる', () => {
      const injury = openWound();
      injury.tryGetProperty(infectionId())!.setNumber(100);
      const jar = filledJar();

      for (let i = 0; i < 4; i++) expect(washing(injury, jar)?.tryExecute(), `${i + 1}杯目`).toBe(true);

      // 1L・1時間で落ち切る。残るのは洗っている4 tickのあいだに進んだ汚れだけで、1にも満たない。
      expect(injury.tryGetProperty(infectionId())?.stage?.name).toBe('clean');
      expect(infectionOf(injury)).toBeLessThan(1);
    });

    it('汚れていない傷は洗えない', () => {
      expect(washing(openWound(), filledJar())?.unmetRequirement()?.reasonName).toBe('already_clean');
    });

    it('1杯に足りない水では洗えない', () => {
      const injury = openWound();
      tick(TO_SEPTIC);

      expect(washing(injury, filledJar('water', 249))?.unmetRequirement()?.reasonName).toBe(
        'not_enough_water',
      );
    });

    it('治療具を当てたままでも洗える', () => {
      // 外させると1回ごとに付け直しの30分が乗り、手間の本体が水から時間へすり替わる
      // （InjurySystem.md 6.2節）。
      const injury = openWound();
      tick(TO_SEPTIC);
      treat(injury, spawnInto('bandage', player, 'hand'));
      const before = infectionOf(injury);

      expect(washing(injury, filledJar())?.tryExecute()).toBe(true);

      expect(before - infectionOf(injury)).toBeCloseTo(25 - 0.25, 10);
      expect(treatmentOn(injury), '当てたまま').toEqual(['bandage']);
    });

    it('膿めば水が余計に要り、回れば血が漏れ出す', () => {
      // 対症療法の効く道と効かない道を同時に持つ（VitalsSystem.md 8.1節）。
      const injury = openWound();
      const hydrationId = codex.propertyNames.getId('hydration');
      const bloodId = codex.propertyNames.getId('blood');

      const lostOver = (count: number): { water: number; blood: number } => {
        const before = {
          water: player.tryGetProperty(hydrationId)!.number,
          blood: player.tryGetProperty(bloodId)!.number,
        };
        for (let i = 0; i < count; i++) player.tick();
        return {
          water: before.water - player.tryGetProperty(hydrationId)!.number,
          blood: before.blood - player.tryGetProperty(bloodId)!.number,
        };
      };

      // 血が固まるまで（4 tick）は傷そのものが血を奪うので、そこを過ぎてから数える。
      lostOver(4);
      expect(lostOver(1), '清潔なうちは素の-1/tickだけ').toEqual({ water: 1, blood: 0 });

      lostOver(TO_FESTERING);
      expect(lostOver(1), '熱で水の保ちが半分になる').toEqual({ water: 2, blood: 0 });

      lostOver(TO_SEPTIC - TO_FESTERING);
      expect(lostOver(1), '3分の1になり、血が漏れ出す').toEqual({ water: 3, blood: 40 });

      // 洗って原因を断てば、どちらも止まる（対症療法では買えないものが、そこで戻る）。
      expect(washing(injury, filledJar())?.tryExecute()).toBe(true);
      expect(washing(injury, filledJar())?.tryExecute()).toBe(true);

      expect(lostOver(1), '2杯で安全域へ戻る').toEqual({ water: 1, blood: 0 });
    });
  });

  it('怪我は荷重にならない', () => {
    pickCoconut();

    expect(player.tryGetProperty(loadId())?.getEffectiveValue() ?? 0).toBe(0);
  });

  describe('骨折', () => {
    it('血は流れず、動きを奪う', () => {
      // 皮膚の下で折れるのでbleedingを持たない（InjurySystem.md 5節）。血を持たない代わりに、
      // 宿主のload（荷重）を押し上げる。
      const injury = breakBone();

      expect(injury.tryGetProperty(codex.propertyNames.getId('bleeding'))).toBeUndefined();
      expect(player.tryGetProperty(loadId())?.getEffectiveValue() ?? 0).toBeGreaterThan(0);
    });

    it('空身なら歩けるが、普段どおりの荷では動けなくなる', () => {
      // 段の名前で見るのは、道のtravelがこの名前で移動可否を決めるから（ContainerSystem.md 5節）。
      // 担ぐのはヤシの実5つ（11kg）——折れていなければ、担いだと数え始めたばかりの荷。
      for (let i = 0; i < 5; i++) spawnInto('green_coconut', player, 'hand');
      expect(player.tryGetProperty(loadId())?.stage?.name, '無傷なら通れる').toBe('laden');

      breakBone();

      expect(player.tryGetProperty(loadId())?.stage?.name, '同じ荷が担げなくなる').toBe('too_heavy');
    });

    it('折れているだけでは歩ける', () => {
      breakBone();

      expect(player.tryGetProperty(loadId())?.stage?.name).toBe('heavy');
    });

    it('1枚で痛みが危険域へ届く', () => {
      // 2節が「1つで危険域に届く量は重い怪我のために取っておく」と空けておいた枠（InjurySystem.md 5節）。
      breakBone();

      expect(player.tryGetProperty(painId)?.stage?.name).toBe('unbearable');
    });

    it('島にある傷の中で最も長く残る', () => {
      // 現実の6〜12週を4分の1へ縮めても順序は崩れていない（DesignPrinciples.md）。**最も軽い
      // 折れ方でも**次に長い捻挫（960 tick）を上回るので、ロールの下振れでも順序は保たれる。
      const severityId = codex.propertyNames.getId('severity');
      const injuries = codex.objectDefNamesWithTag(codex.tagNames.getId('injury'));
      expect(injuries.length, '検査対象が無い（injuryタグが変わっていないか）').toBeGreaterThan(1);

      const longestOthers = Math.max(
        ...injuries
          .filter((name) => name !== 'fracture')
          .map(
            (name) =>
              codex.objects.get(codex.objectNames.getId(name)).tryGetPropertyDef(severityId)?.range?.max ?? 0,
          ),
      );
      const fractureDef = codex.objects.get(codex.objectNames.getId('fracture'));
      const initial = fractureDef.tryGetPropertyDef(severityId)!.initialValueReading;

      expect(initial.kind, '折れ方の違いは生成時のロールが引き受ける（6.2節）').toBe('roll');
      expect(initial.kind === 'roll' && initial.min, '最も軽い折れ方でも他のどの傷より長い').toBeGreaterThan(
        longestOthers,
      );
    });
  });

  describe('添え木', () => {
    const severityId = () => codex.propertyNames.getId('severity');

    /** 怪我と、手持ちに持たせた添え木を返す。 */
    function splintFor(injury: WorldObject): { injury: WorldObject; splint: WorldObject } {
      return { injury, splint: spawnInto('splint', player, 'hand') };
    }

    /** count tick進める間に、その怪我の傷がどれだけ引いたか。 */
    function healedOver(injury: WorldObject, count: number): number {
      const before = injury.tryGetProperty(severityId())?.number ?? 0;
      tick(count);
      return before - (injury.tryGetProperty(severityId())?.number ?? 0);
    }

    it('骨折へ当てると、押し上げが緩んで普段どおりの荷を担げる', () => {
      // 折れていなければladen（ContainerSystem.md 5節の通れる段）のヤシの実5つ（11kg）。
      for (let i = 0; i < 5; i++) spawnInto('green_coconut', player, 'hand');
      const { injury, splint } = splintFor(breakBone());
      expect(player.tryGetProperty(loadId())?.stage?.name, '当てる前は担げない').toBe('too_heavy');

      treat(injury, splint);

      expect(treatmentOn(injury)).toEqual(['splint']);
      expect(player.tryGetProperty(loadId())?.stage?.name, '添え木の重さを担いでも道は通れる').toBe('heavy');
    });

    it('外せば押し上げも戻る', () => {
      // 可逆な寄与（InjurySystem.md 3節）。緩みは当てている間だけで、外した瞬間に元の押し上げへ戻る。
      for (let i = 0; i < 5; i++) spawnInto('green_coconut', player, 'hand');
      const { injury, splint } = splintFor(breakBone());
      treat(injury, splint);

      removeTreatment(splint);

      expect(player.tryGetProperty(loadId())?.stage?.name).toBe('too_heavy');
    });

    it('当てている間だけ治りが早まる', () => {
      const { injury, splint } = splintFor(breakBone());
      expect(healedOver(injury, 10), '当てる前は自然治癒だけ').toBeCloseTo(1 * 10, 10);

      treat(injury, splint);

      // 自然治癒の-1/tickに、添え木の-0.6/tickが重なる（8.4節）。包帯の-1.4/tickより速い。
      expect(healedOver(injury, 10)).toBeCloseTo(1.6 * 10, 10);

      removeTreatment(splint);

      expect(healedOver(injury, 10), '外せば元の速さへ戻る').toBeCloseTo(1 * 10, 10);
    });

    it('押し上げていない傷へ当てても、荷は軽くならない', () => {
      // 緩める量は押し上げている骨折が持つ（injuries.yaml）。治療具の側に「-9,000」と書いていたら、
      // 荷重を押し上げない捻挫へ当てたときに無傷より軽くなる。
      pickCoconut();
      const { injury, splint } = splintFor(new PlayerCharacter(player, codex).injuryStacks[0][0]);
      const before = player.tryGetProperty(loadId())?.getEffectiveValue() ?? 0;

      treat(injury, splint);

      expect(player.tryGetProperty(loadId())?.getEffectiveValue() ?? 0, '添え木の重さぶんのまま').toBe(
        before,
      );
      expect(before, '手持ちでも怪我の中でも、添え木の重さは同じだけ担いでいる').toBe(1400);
    });

    it('出血には効かない', () => {
      // 皮膚の下で折れる傷に止める血は流れていないので、止血の口を持たない（InjurySystem.md 3.1節）。
      // 血の流れる傷へ当てても、固まる速さは自然のまま——倍にするのは包帯だけ。
      const bleedingId = codex.propertyNames.getId('bleeding');
      const bloodId = codex.propertyNames.getId('blood');
      const { injury, splint } = splintFor(spawnInto('laceration', player, 'injuries'));
      treat(injury, splint);
      const bleedingBefore = injury.tryGetProperty(bleedingId)?.number ?? 0;
      const bloodBefore = player.tryGetProperty(bloodId)?.number ?? 0;

      tick(1);

      expect(
        bleedingBefore - (injury.tryGetProperty(bleedingId)?.number ?? 0),
        '固まる速さは変わらない',
      ).toBe(25);
      expect(bloodBefore - (player.tryGetProperty(bloodId)?.number ?? 0), '血も止まらない').toBe(15);
    });
  });
});
