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
  /** 捻挫が治りきるまでのtick数（durability 960,000 ÷ 1,000）。 */
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

  it('怪我は手持ちにも足元にも置けない', () => {
    // injuryタグはhand（itemのみ）・土地のitemsを通らないため、負った本人から離れられない。
    pickCoconut();
    const injury = new PlayerCharacter(player, codex).injuryStacks[0][0];

    expect(injury.moveToSlot(player, codex.slotNames.getId('hand'), codex.wellKnown)).toBeDefined();
    expect(injury.moveToSlot(beach, codex.slotNames.getId('items'), codex.wellKnown)).toBeDefined();
  });

  it('怪我は荷重にならない', () => {
    const loadId = codex.propertyNames.getId('load');

    pickCoconut();

    expect(player.getEffectiveValue(loadId)).toBe(0);
  });
});
