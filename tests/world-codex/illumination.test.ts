import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { Location } from '../../src/domain/wrappers/Location';
import { Path } from '../../src/domain/wrappers/Path';
import { World } from '../../src/domain/wrappers/World';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { fixedRng } from '../support/rng';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * 明るさが行動を制限することを、実ファイルの定義だけで検証する
 * （docs/engine/IlluminationSystem.md 2節・3節・5節）。
 *
 * 見るのは「どの値が誰へ届くか」で、値そのもの（樹冠・光源の段数）は
 * docs/world/ContentSkeleton.md 8.1節が持つ。
 */

/** 夜。太陽が地平線の下なので、世界の明るさは底（-6）に張り付く。 */
const NIGHT_HOUR = 0;
/** 正午。晴れ（clear）なら世界の明るさは+14。 */
const NOON_HOUR = 12;
/** 朝。晴れなら世界の明るさは+13で、密林（-9）だけがしきい値（+5）に届かない。 */
const MORNING_HOUR = 9;

describe('明るさが行動を制限する', () => {
  let codex: WorldCodex;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
  });

  /** 土地の上にプレイヤーが1人立っている世界。時刻だけを引数で変える（天気は既定のclear）。 */
  function open(hour: number, landName: string) {
    const worldInstance = new WorldObject(
      0,
      codex.objects.get(codex.objectNames.getId('world')),
      new WorldSession(codex),
    );
    const worldView = new World(worldInstance, codex);
    const session = new WorldSession(codex, worldView, fixedRng(0));
    worldInstance.getProperty(codex.propertyNames.getId('hour')).setNumberWithoutEvents(hour);

    const land = spawnInto(session, landName, worldInstance, 'locations');
    const player = spawnInto(session, SAMPLE_CHARACTER, land, 'characters');
    return { session, worldInstance, land, player };
  }

  function spawnInto(
    session: WorldSession,
    objectName: string,
    parent: WorldObject,
    slotName: string,
  ): WorldObject {
    const spawned = session.createObject(codex.objectNames.getId(objectName));
    expect(spawned.moveToSlotOrRejection(parent.getSlot(codex.slotNames.getId(slotName)))).toBeUndefined();
    return spawned;
  }

  /** 明るさは土台（base）と光源（modify）が積み上げた実効値でしか意味を持たない。 */
  function brightnessOf(object: WorldObject, propertyName: string): number {
    return object.getProperty(codex.propertyNames.getId(propertyName)).getEffectiveValue();
  }

  /** 灯した松明。lightは火種を要求するので、テストは灯った状態を直接作る。 */
  function litTorch(session: WorldSession, parent: WorldObject, slotName: string): WorldObject {
    const torch = spawnInto(session, 'torch', parent, slotName);
    torch.getProperty(codex.propertyNames.getId('lit')).setNumberWithoutEvents(1);
    return torch;
  }

  /** 燃えている焚き火。火力が0より大きいことが「火が生きている」（FireSystem.md 2節）。 */
  function litCampfire(session: WorldSession, land: WorldObject): WorldObject {
    const campfire = spawnInto(session, 'campfire', land, 'fixtures');
    campfire.getProperty(codex.propertyNames.getId('heat')).setNumberWithoutEvents(20);
    return campfire;
  }

  it('夜は屋外で採れない（昼なら同じ土地で採れる）', () => {
    const night = open(NIGHT_HOUR, 'grassland');
    expect(brightnessOf(night.player, 'looking_brightness'), '夜の草原は底（-6）').toBe(-6);
    expect(new Location(night.land, codex).explore(night.player), '夜は探索できない').toBe(false);

    const noon = open(NOON_HOUR, 'grassland');
    expect(new Location(noon.land, codex).explore(noon.player), '同じ土地でも昼なら探索できる').toBe(true);
  });

  it('夜でも、松明を持っていれば屋外で採れる', () => {
    const { session, land, player } = open(NIGHT_HOUR, 'grassland');
    litTorch(session, player, 'hand');

    expect(brightnessOf(player, 'looking_brightness'), '底（-6）から松明が+11押し上げる').toBe(5);
    expect(new Location(land, codex).explore(player)).toBe(true);
  });

  it('夜の道は、松明を手に持っているときだけ歩ける', () => {
    expect(
      travelsAtNight((session, land, player) => litTorch(session, player, 'hand')),
      '手に持つ',
    ).toBe(true);
    expect(
      travelsAtNight(() => undefined),
      '明かり無し',
    ).toBe(false);
    expect(
      travelsAtNight((session, land) => litTorch(session, land, 'items')),
      '地面へ置いた松明は、歩き出した本人を照らさない',
    ).toBe(false);
    expect(
      travelsAtNight((session, land) => litCampfire(session, land)),
      '焚き火のそばからも夜の道へは出られない',
    ).toBe(false);
  });

  it('夜でも、焚き火のそばなら手元の作業を進められる', () => {
    const dark = open(NIGHT_HOUR, 'grassland');
    expect(spinsFiber(dark.session, dark.land, dark.player), '明かり無しでは撚れない').toBe(false);

    const lit = open(NIGHT_HOUR, 'grassland');
    litCampfire(lit.session, lit.land);
    expect(brightnessOf(lit.player, 'hand_brightness'), '底（-6）から焚き火が+11押し上げる').toBe(5);
    expect(
      brightnessOf(lit.player, 'looking_brightness'),
      '据えた火は視界には届かない（採りには出られない）',
    ).toBe(-6);
    expect(spinsFiber(lit.session, lit.land, lit.player), '焚き火のそばなら撚れる').toBe(true);
  });

  it('密林の日中は、開けた土地より暗い', () => {
    const jungle = open(NOON_HOUR, 'jungle');
    const grassland = open(NOON_HOUR, 'grassland');
    expect(brightnessOf(jungle.land, 'ambient_brightness'), '樹冠と林床で9段暗い').toBe(
      brightnessOf(grassland.land, 'ambient_brightness') - 9,
    );

    // 差が線を跨ぐ時間帯があることまで見る。同じ晴れの朝に、草原では採れて密林では採れない。
    const morningJungle = open(MORNING_HOUR, 'jungle');
    const morningGrassland = open(MORNING_HOUR, 'grassland');
    expect(new Location(morningGrassland.land, codex).explore(morningGrassland.player)).toBe(true);
    expect(new Location(morningJungle.land, codex).explore(morningJungle.player)).toBe(false);
  });

  /**
   * 夜の道を1本置いて、渡れたかを返す。`putLight`が、その世界へ置く明かりを決める
   * （置かないなら何もしない）。
   */
  function travelsAtNight(
    putLight: (session: WorldSession, land: WorldObject, player: WorldObject) => unknown,
  ): boolean {
    const { session, worldInstance, land, player } = open(NIGHT_HOUR, 'grassland');
    const destination = spawnInto(session, 'forest', worldInstance, 'locations');
    const path = spawnInto(session, 'path', land, 'fixtures');
    path
      .getProperty(codex.propertyNames.getId('destination_id'))
      .setNumberWithoutEvents(destination.instanceId);
    putLight(session, land, player);

    return new Path(path, codex).travel(player);
  }

  /** 繊維2束を撚る（fiber.yamlのspin）。手元の明るさを要求する工程の代表。 */
  function spinsFiber(session: WorldSession, land: WorldObject, player: WorldObject): boolean {
    const first = spawnInto(session, 'plant_fiber', land, 'items');
    const second = spawnInto(session, 'plant_fiber', land, 'items');
    return (
      first
        .combinationsWith(second, player)
        .find((combination) => combination.name === 'spin')
        ?.tryExecute() === true
    );
  }
});
