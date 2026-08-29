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
   */
  function tick(count: number): void {
    const vital = ['hydration', 'body_fat', 'lipid'].map((name) => codex.propertyNames.getId(name));
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
