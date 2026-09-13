import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { World } from '../../src/domain/wrappers/World';
import { fixedRng } from '../support/rng';
import { bundledCodex, SAMPLE_CHARACTER } from '../support/worldCodexFiles';

/**
 * 湧き水（locations.yamlのspring）から器へ水を汲めることの検証
 * （docs/engine/LiquidContainerSystem.md 10節）。
 *
 * 見るのは「空の器へ汲める」「入る量は器が決める」「汲んだ水が飲める」「別の液体の器と暗がりは
 * 断る」。注ぎ移しと蒸発そのものはtests/world-codex/liquidContainersYaml.test.tsが受け持つ。
 */

/** 湧き水が湧く土地の1つ（locations.yamlのgrasslandのexplore）。 */
const SPRING_LAND = 'grassland';
/** 正午。屋外の作業に要る明るさ（IlluminationSystem.md 5節）が足りる時刻。 */
const NOON_HOUR = 12;
/** 夜。太陽が地平線の下なので、屋外の明るさは底に張り付く。 */
const NIGHT_HOUR = 0;

describe('湧き水', () => {
  let codex: WorldCodex;

  beforeAll(() => {
    codex = bundledCodex();
  });

  /** 草原に湧き水が1つあり、その傍らにプレイヤーが立っている世界。 */
  function atSpring(hour = NOON_HOUR) {
    const worldInstance = new WorldObject(
      0,
      codex.objects.get(codex.objectNames.getId('world')),
      new WorldSession(codex),
    );
    const worldView = new World(worldInstance, codex);
    const session = new WorldSession(codex, worldView, fixedRng(0));
    worldInstance.getProperty(codex.propertyNames.getId('hour')).setNumberWithoutEvents(hour);
    worldInstance
      .getProperty(codex.propertyNames.getId('weather'))
      .setNumberWithoutEvents(codex.symbolNames.getId('clear'));

    const land = spawnInto(session, SPRING_LAND, worldInstance, 'locations');
    const spring = spawnInto(session, 'spring', land, 'fixtures');
    const player = spawnInto(session, SAMPLE_CHARACTER, land, 'characters');
    return { session, land, spring, player };
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

  /** 器を土地のitems枠へ置く。手に持っているかは汲む条件に関わらない（見るのは視界の明るさだけ）。 */
  function spawnContainer(session: WorldSession, land: WorldObject, containerName: string): WorldObject {
    return spawnInto(session, containerName, land, 'items');
  }

  function amountIn(container: WorldObject): number {
    return container.tryGetProperty(codex.propertyNames.getId('fill'))?.number ?? 0;
  }

  function propertyOf(object: WorldObject, propertyName: string): number {
    return object.getProperty(codex.propertyNames.getId(propertyName)).getEffectiveValue();
  }

  /** その容器が抱えられる量の上限（中身入りの変種のfillのrangeが持つ）。 */
  function capacityOf(containerName: string): number | undefined {
    const fillId = codex.propertyNames.getId('fill');
    const def = codex.objects.get(codex.objectNames.getId(`${containerName}__content_water_liquid`));
    return def.enumeratePropertyDefs().find((p) => p.globalId === fillId)?.range?.max;
  }

  it('空の器を湧き水へ重ねると、水入りの器になって口まで満ちる', () => {
    const { session, land, spring, player } = atSpring();
    const jar = spawnContainer(session, land, 'jar');

    expect(
      spring
        .combinationsWith(jar, player)
        .find((c) => c.name === 'draw_into_empty')
        ?.tryExecute() === true,
    ).toBe(true);

    expect(jar.def.name, '器そのものが水入りの変種になる').toBe('jar__content_water_liquid');
    expect(amountIn(jar)).toBe(capacityOf('jar'));
  });

  it('入る量は器が決める', () => {
    // 湧き水は器ごとの容量を知らない（汲む宣言はどの器にも同じ量を書く）。溢れる分を捨てるのは
    // エンジン側の不変条件なので、小さい器はその容量で止まる。
    const { session, land, spring, player } = atSpring();
    const bowl = spawnContainer(session, land, 'coconut_bowl');

    expect(
      spring
        .combinationsWith(bowl, player)
        .find((c) => c.name === 'draw_into_empty')
        ?.tryExecute() === true,
    ).toBe(true);

    expect(amountIn(bowl)).toBe(capacityOf('coconut_bowl'));
    expect(capacityOf('coconut_bowl')).toBeLessThan(capacityOf('jar')!);
  });

  it('汲んだ水は飲めて、水分が戻る', () => {
    const { session, land, spring, player } = atSpring();
    const bowl = spawnContainer(session, land, 'coconut_bowl');
    spring
      .combinationsWith(bowl, player)
      .find((c) => c.name === 'draw_into_empty')
      ?.tryExecute();
    const before = propertyOf(player, 'hydration');

    expect(bowl.tryGetAction('drink', player)?.tryExecute() === true).toBe(true);

    expect(propertyOf(player, 'hydration')).toBeGreaterThan(before);
  });

  it('水の残っている器には汲み足せる', () => {
    const { session, land, spring, player } = atSpring();
    const jar = spawnContainer(session, land, 'jar');
    spring
      .combinationsWith(jar, player)
      .find((c) => c.name === 'draw_into_empty')
      ?.tryExecute();
    jar.getProperty(codex.propertyNames.getId('fill')).setNumberWithoutEvents(500);

    expect(
      spring
        .combinationsWith(jar, player)
        .find((c) => c.name === 'draw_into_filled')
        ?.tryExecute() === true,
    ).toBe(true);

    expect(amountIn(jar)).toBe(capacityOf('jar'));
  });

  it('別の液体が入った器は断り、理由not_emptyを返す', () => {
    // 水と混ざらない（LiquidContainerSystem.md 4節）。断る理由が届かないと、画面には何も起きない
    // 操作として出る。
    const { session, land, spring, player } = atSpring();
    const tea = spawnInto(session, 'jar__content_tea_liquid', land, 'items');
    tea.getProperty(codex.propertyNames.getId('fill')).setNumberWithoutEvents(500);

    expect(
      spring.combinationsWith(tea, player).map((c) => c.name),
      '成立する向きは無い',
    ).toEqual([]);

    const refused = spring.refusedCombinationsWith(tea, player).at(0);

    expect(refused?.unmetRequirement()?.reasonName).toBe('not_empty');
    expect(amountIn(tea), '中身は入れ替わらない').toBe(500);
  });

  it('暗ければ汲めず、理由too_darkを返す', () => {
    // 屈んで器を沈める屋外の行動なので、視界の明るさを見る（IlluminationSystem.md 5節）。
    const { session, land, spring, player } = atSpring(NIGHT_HOUR);
    const jar = spawnContainer(session, land, 'jar');

    expect(spring.combinationsWith(jar, player).map((c) => c.name)).toEqual([]);

    const refused = spring.refusedCombinationsWith(jar, player).at(0);

    expect(refused?.unmetRequirement()?.reasonName).toBe('too_dark');
    expect(jar.def.name, '器は空のまま').toBe('jar');
  });
});
