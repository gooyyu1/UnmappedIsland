import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { World } from '../../src/domain/wrappers/World';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { makeBrightEnoughForAnyAction } from '../support/illumination';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * 限界に達した値が起こす、強制的な時間経過（docs/world/Characters.md 限界節）を、実ファイルの
 * 定義だけで検証する。
 *
 * **時間を進める操作の最中に限界へ達するところを通す。** 道を歩く60分のあいだに手番が配られ、
 * それが操作の切れ目まで待たされる、というのが仕組みの要（GameElementDefinition.md 11.5節）で、
 * 値を0に置いて眺めるだけでは1つも動かない。
 */
describe('限界に達した値が起こす、強制的な時間経過', () => {
  /** 道1本を歩く時間（locations.yamlのtravel_minutes×pace。素の歩みは等倍）。 */
  const TRAVEL_MINUTES = 60;

  /**
   * 3つの限界。**違うのは見る値・長さ・戻る量だけ**なので、同じ表に並ぶ（player_character.yaml）。
   *
   * `after` は強制の時間が過ぎ切った時点の値で、宣言した戻る量そのままになる。**強制の間の減り
   * （眠気の-1/tick）は下限のクランプが吸う**ので、自発の睡眠と違って経過ぶんは引かれない。
   */
  const LIMITS = [
    { prop: 'stamina', turn: 'collapse', minutes: 120, after: 20 },
    { prop: 'wakefulness', turn: 'fall_asleep', minutes: 360, after: 96 },
    { prop: 'happiness', turn: 'despair', minutes: 120, after: 20 },
  ] as const;

  let codex: WorldCodex;
  let session: WorldSession;
  let world: WorldObject;
  let jungle: WorldObject;
  let grassland: WorldObject;
  let player: WorldObject;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
  });

  beforeEach(() => {
    open();
  });

  /** 道1本で繋いだ2つの土地と、密林に立つプレイヤー。 */
  function open(): void {
    session = new WorldSession(codex);
    world = new WorldObject(0, codex.objects.get(codex.objectNames.getId('world')), session);
    session.adoptWorld(new World(world, codex));
    jungle = spawnInto('jungle', world, 'locations');
    grassland = spawnInto('grassland', world, 'locations');
    player = spawnInto(SAMPLE_CHARACTER, jungle, 'characters');
    // 道は暗ければ歩けない（IlluminationSystem.md 5節）。見たいのは限界の側なので、時刻や光源を
    // 組み立てずに作業者の側で明るさを満たす。
    makeBrightEnoughForAnyAction(player, codex);

    const path = spawnInto('path', jungle, 'fixtures');
    path
      .getProperty(codex.propertyNames.getId('destination_id'))
      .setNumberWithoutEvents(grassland.instanceId);
  }

  function spawnInto(objectName: string, parent: WorldObject, slotName: string): WorldObject {
    const spawned = session.createObject(codex.objectNames.getId(objectName));
    expect(spawned.moveToSlotOrRejection(parent.getSlot(codex.slotNames.getId(slotName)))).toBeUndefined();
    return spawned;
  }

  function valueOf(propertyName: string): number {
    return player.getProperty(codex.propertyNames.getId(propertyName)).number;
  }

  function drain(propertyName: string): void {
    player.getProperty(codex.propertyNames.getId(propertyName)).setNumber(0);
  }

  /** 密林から草原へ歩く。戻り値は、その1回で実際に過ぎたゲーム内時間（分）。 */
  function travel(): number {
    const before = session.world!.totalMinutes;
    const path = jungle.getSlot(codex.slotNames.getId('fixtures')).contents[0];
    expect(path.tryGetAction('travel', player)?.tryExecute()).toBe(true);
    return session.world!.totalMinutes - before;
  }

  it.each(LIMITS)(
    '$prop が尽きると、$turn で $minutes 分が強制的に過ぎ、その間に戻る',
    ({ prop, minutes, after }) => {
      drain(prop);

      expect(travel(), '歩いた分に、強制の時間が続く').toBe(TRAVEL_MINUTES + minutes);
      expect(valueOf(prop)).toBe(after);
    },
  );

  it('進行中の操作は中断しない——歩き終わってから倒れる', () => {
    // 中断しないという答え（GameElementDefinition.md 11.5節）が、行き先に着いていることに出る。
    drain('stamina');

    travel();

    expect(player.parent).toBe(grassland);
  });

  it('切れ目までに限界を抜けていれば、待たせた手番は起きない', () => {
    // 待たせた手番の要件は切れ目で引き直される。待機は15分で体力を+2戻すので、切れ目に着いた
    // 時点では下限に居ない。
    drain('stamina');
    const before = session.world!.totalMinutes;

    expect(player.tryGetAction('wait', player)?.tryExecute()).toBe(true);

    expect(session.world!.totalMinutes - before, '待機の15分だけ').toBe(15);
    expect(valueOf('stamina')).toBe(2);
  });

  it('2つ同時に尽きれば、同じ切れ目で続けて起きる', () => {
    drain('stamina');
    drain('happiness');

    expect(travel()).toBe(TRAVEL_MINUTES + 120 + 120);
    expect(valueOf('stamina')).toBe(20);
    expect(valueOf('happiness')).toBe(20);
  });

  it('強制の最中に別の限界へ落ちても、同じ切れ目では続けない', () => {
    // 強制の時間経過そのものが時間を進めるので、その最中にまた手番が挙がりうる。ここで受け取ると
    // 切れ目から抜けられないので、次に時間が動いたときの待ちとして拾い直す。
    //
    // 眠気は歩く4 tickでは尽きず（5→1）、倒れ込む8 tickの途中で尽きる。
    drain('stamina');
    player.getProperty(codex.propertyNames.getId('wakefulness')).setNumber(5);

    expect(travel(), '倒れ込む120分だけで、眠り込む360分は続かない').toBe(TRAVEL_MINUTES + 120);
    expect(valueOf('wakefulness'), '眠気は尽きたまま').toBe(0);

    expect(travel(), '次に時間が動いたときに眠り込む').toBe(TRAVEL_MINUTES + 360);
  });

  it('戻り切らずにまた尽きれば、次に時間が動いたときにまた起きる', () => {
    drain('happiness');
    expect(travel()).toBe(TRAVEL_MINUTES + 120);

    drain('happiness');
    expect(travel(), '一度きりではない').toBe(TRAVEL_MINUTES + 120);
  });

  it('限界に居ない間は、何も起きない', () => {
    // 見張りが常に強制していないことの裏取り。満タンのまま歩けば、歩いた分しか過ぎない。
    expect(travel()).toBe(TRAVEL_MINUTES);
  });
});
