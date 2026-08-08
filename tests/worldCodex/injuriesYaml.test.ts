import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { WorldObject } from '../../src/domain/runtime/WorldObject';
import { WorldSession } from '../../src/domain/runtime/WorldSession';
import { PlayerCharacter } from '../../src/domain/runtime/views/PlayerCharacter';
import { World } from '../../src/domain/runtime/views/World';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { fixedRng } from '../support/rng';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * injuries.yamlの怪我を、実ファイルの定義だけで検証する（docs/world/Injuries.md）。
 * 負う契機（ヤシの木からの落下）・痛みへの影響・時間で治ることの3つを通す。
 */
describe('injuries.yamlの怪我', () => {
  /** pick_coconutで捻挫する側を引く重みの位置（成功90 : 失敗10）。 */
  const FALLS = 0.95;
  /** 捻挫が治りきるまでのtick数（severity 96,000 ÷ 100）。 */
  const HEALING_TICKS = 960;

  let codex: WorldCodex;
  let session: WorldSession;
  let beach: WorldObject;
  let player: WorldObject;
  let painId: number;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
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
    session = new WorldSession(
      codex,
      new World(worldInstance, codex.propertyNames, codex.symbolNames),
      fixedRng(roll),
    );
    beach = spawnInto('sandy_beach', worldInstance, 'locations');
    player = spawnInto(SAMPLE_CHARACTER, beach, 'characters');
  }

  function spawnInto(objectName: string, parent: WorldObject, slotName: string): WorldObject {
    const spawned = session.spawn(codex.objectNames.getId(objectName));
    expect(spawned.moveToSlot(parent, codex.slotNames.getId(slotName), codex.wellKnown)).toBeUndefined();
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

  /** ヤシの実を採ろうとする。成否はopenへ渡したrollで決まっている。 */
  function pickCoconut(): void {
    const tree = spawnInto('palm_tree', beach, 'fixtures');
    expect(tree.tryExecuteAction('pick_coconut', player, session)).toBe(true);
  }

  function tick(count: number): void {
    for (let i = 0; i < count; i++) player.tick(session);
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
    expect(player.getEffectiveValue(painId)).toBe(0);
  });

  it('怪我は痛みを押し上げ、重なるほど強くなる', () => {
    expect(player.getEffectiveValue(painId), '無傷なら痛みは無い').toBe(0);

    pickCoconut();
    expect(player.getEffectiveValue(painId)).toBe(40);

    pickCoconut();
    expect(injuriesOf(player), '同じ怪我でも2つぶん負う').toEqual(['sprained_ankle', 'sprained_ankle']);
    expect(player.getEffectiveValue(painId), 'modifyは単純加算される（8.3節）').toBe(80);
  });

  it('痛みは怪我が治るまで残り、治れば引く', () => {
    pickCoconut();

    tick(HEALING_TICKS - 1);
    expect(injuriesOf(player), '治りきる手前ではまだ残っている').toEqual(['sprained_ankle']);
    expect(player.getEffectiveValue(painId)).toBe(40);

    tick(1);
    expect(injuriesOf(player), '傷が尽きた瞬間に消える').toEqual([]);
    expect(player.getEffectiveValue(painId), '可逆な寄与なので痛みも消える').toBe(0);
  });

  it('怪我は負った本人から離せない', () => {
    // bound_to_owner（7.9節）。身体から離れた「捻挫」は存在しないので、どこへも移せない
    // ——手持ちや足元がinjuryタグを弾くからではなく、その物がそう在れないから。
    pickCoconut();
    const injury = new PlayerCharacter(player, codex).injuryStacks[0][0];

    expect(injury.moveToSlot(beach, codex.slotNames.getId('items'), codex.wellKnown)).toContain('離せません');
    // 同じ本人の中でも手持ちへは移らない。こちらを弾くのはhandのaccepts（itemのみ）。
    expect(injury.moveToSlot(player, codex.slotNames.getId('hand'), codex.wellKnown)).toBeDefined();
    expect(injuriesOf(player), '弾かれた側は怪我スロットに残る').toEqual(['sprained_ankle']);
  });

  it('傷の重さは道具の耐久度と別のプロパティで、引くほど軽い域へ移る', () => {
    // 耐久値は多いほど良い量、傷は多いほど悪い量なので、同じ語彙には載せない（Injuries.md）。
    pickCoconut();
    const injury = new PlayerCharacter(player, codex).injuryStacks[0][0];

    expect(injury.readProperty(codex.propertyNames.getId('durability'))).toBeUndefined();

    const severityId = codex.propertyNames.getId('severity');
    expect(injury.readProperty(severityId)?.alert, '負った直後は要注意域').toBe('caution');
    expect(injury.readProperty(severityId)?.worsensUpward, '増えるほど悪い').toBe(true);

    tick(HEALING_TICKS / 2);

    expect(injury.readProperty(severityId)?.alert, '半分治れば留意域').toBe('watch');
    expect(injury.readProperty(severityId)?.ratio).toBeCloseTo(0.5, 2);
  });

  describe('手当て', () => {
    /** 捻挫を1つ負い、その怪我と、手持ちに持たせた包帯を返す。 */
    function injured(): { injury: WorldObject; bandage: WorldObject } {
      pickCoconut();
      const injury = new PlayerCharacter(player, codex).injuryStacks[0][0];
      return { injury, bandage: spawnInto('bandage', player, 'hand') };
    }

    /** その怪我に当たっている治療具の識別子（当てていなければ空）。 */
    function treatmentOn(injury: WorldObject): string[] {
      const slot = injury.tryGetSlot(codex.slotNames.getId('treatment'));
      return slot === undefined ? [] : slot.contents.map((object) => object.def.name);
    }

    it('包帯を怪我へ重ねると、その怪我に当たった状態になる', () => {
      const { injury, bandage } = injured();

      expect(injury.tryExecuteCombination(bandage, player, 'treat', session)).toBe(true);

      expect(treatmentOn(injury)).toEqual(['bandage']);
      expect(bandage.parent, '手持ちから怪我の中へ移る').toBe(injury);
    });

    it('当てられるのは1つだけ', () => {
      const { injury, bandage } = injured();
      expect(injury.tryExecuteCombination(bandage, player, 'treat', session)).toBe(true);
      const second = spawnInto('bandage', player, 'hand');

      injury.tryExecuteCombination(second, player, 'treat', session);

      expect(treatmentOn(injury), '2つめは入らない').toEqual(['bandage']);
      expect(second.parent, '入らなかった治療具は手元に残る').toBe(player);
    });

    it('治療具でない物は当てられない', () => {
      const { injury } = injured();
      const stone = spawnInto('stone', player, 'hand');

      expect(stone.moveToSlot(injury, codex.slotNames.getId('treatment'), codex.wellKnown)).toBeDefined();
      expect(treatmentOn(injury)).toEqual([]);
    });

    it('包帯を当てている間は、治りが速くなり痛みも減る', () => {
      const { injury, bandage } = injured();
      const severityId = codex.propertyNames.getId('severity');
      const before = injury.getNumber(severityId);
      expect(player.getEffectiveValue(painId)).toBe(40);

      expect(injury.tryExecuteCombination(bandage, player, 'treat', session)).toBe(true);

      expect(player.getEffectiveValue(painId), '当てている間だけ痛みが引く').toBe(30);
      tick(10);
      // 自然治癒の-100/tickに、包帯の-40/tickが重なる（8.4節）。
      expect(before - injury.getNumber(severityId)).toBe(140 * 10);
    });

    it('外せば効き目も消える', () => {
      const { injury, bandage } = injured();
      expect(injury.tryExecuteCombination(bandage, player, 'treat', session)).toBe(true);

      expect(bandage.moveToSlot(player, codex.slotNames.getId('hand'), codex.wellKnown)).toBeUndefined();

      expect(player.getEffectiveValue(painId), '可逆な寄与なので戻る').toBe(40);
      const severityId = codex.propertyNames.getId('severity');
      const before = injury.getNumber(severityId);
      tick(10);
      expect(before - injury.getNumber(severityId), '治りの速さも元へ戻る').toBe(100 * 10);
    });

    it('手持ちに入れているだけの治療具は効かない', () => {
      // ancestorはスロットを問わず祖先を辿るので、conditionsで当てている間に絞っている。
      pickCoconut();
      spawnInto('bandage', player, 'hand');

      expect(player.getEffectiveValue(painId)).toBe(40);
    });

    it('怪我が治れば、当てていた治療具はこぼれ出る', () => {
      // 治った怪我はdestroyされるが、包帯は単独で在れるので道連れにならず、怪我の親——つまり
      // 負っていた本人——へこぼれ出る（GameElementDefinition.md 7.9節）。
      const { injury, bandage } = injured();
      expect(injury.tryExecuteCombination(bandage, player, 'treat', session)).toBe(true);

      tick(HEALING_TICKS);

      expect(injuriesOf(player)).toEqual([]);
      expect(injury.parent, '怪我は世界から外れる').toBeUndefined();
      expect(bandage.parent, '包帯は本人の手元へ戻る').toBe(player);
      expect(handOf(player)).toEqual(['bandage']);
    });
  });

  it('怪我は荷重にならない', () => {
    const loadId = codex.propertyNames.getId('load');

    pickCoconut();

    expect(player.getEffectiveValue(loadId)).toBe(0);
  });
});
