import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildBalanceTables } from '../../src/analysis/balanceTables';
import type { PropertyGlobalId } from '../../src/domain/GlobalId';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { Location } from '../../src/domain/wrappers/Location';
import { World } from '../../src/domain/wrappers/World';
import { fixedRng } from '../support/rng';
import { bundledCodex, SAMPLE_CHARACTER } from '../support/worldCodexFiles';
import { makeBrightEnoughForAnyAction } from '../support/illumination';

/**
 * firewood.yamlの薪割りと薪棚を、実ファイルの定義だけで検証する。
 *
 * 見張るのは、火の系統の山が山として立っている主張（docs/engine/FireSystem.md 2.5節）そのもの
 * ——**割っただけでは熱が増えないこと**・**乾かすのは棚だけの仕事であること**・**乾いた薪の率が木から
 * 取り出せる上限に届き、それを超えないこと**・**それで燃料1点あたりの手間が拾った枝より安くなること**。
 * どれが破れても、棚を据える1日以上の手間が何も安くしなくなる。
 *
 * **乾きを数える試験に人は立てない。** 疲れたキャラクタは1度の時間送りで何時間も眠るので、進めた
 * tickと世界の進みが食い違う。人が要るのは薪を割る側だけ。
 */
describe('firewood.yamlの薪割りと薪棚', () => {
  /** 1tickの長さ（core.yamlのminutes_per_tick）。 */
  const TICK_MINUTES = 15;

  let codex: WorldCodex;
  let session: WorldSession;
  let forest: WorldObject;
  let fuelId: PropertyGlobalId;
  let weightId: PropertyGlobalId;
  let seasoningRemainingId: PropertyGlobalId;

  beforeAll(() => {
    // 丸太（timber.yaml）・縄（fiber.yaml）・編んだ葉（weaving.yaml）への参照があるため、
    // ディレクトリ全体を一括ロードする。
    codex = bundledCodex();
    fuelId = codex.propertyNames.getId('fuel');
    weightId = codex.propertyNames.getId('weight');
    seasoningRemainingId = codex.propertyNames.getId('seasoning_remaining');
  });

  beforeEach(() => {
    const worldInstance = new WorldObject(
      0,
      codex.objects.get(codex.objectNames.getId('world')),
      new WorldSession(codex),
    );
    session = new WorldSession(codex, new World(worldInstance), fixedRng(0));
    forest = spawnInto('forest', worldInstance, 'locations');
  });

  function spawnInto(objectName: string, parent: WorldObject, slotName: string): WorldObject {
    const spawned = session.createObject(codex.objectNames.getId(objectName));
    expect(spawned.moveToSlotOrRejection(parent.getSlot(codex.slotNames.getId(slotName)))).toBeUndefined();
    return spawned;
  }

  /**
   * 森に立つプレイヤー。**薪を割る試験だけが呼ぶ**（上のdocコメント）。斧を振るのは明るさを要求する
   * （IlluminationSystem.md 5節）が、ここで見たいのは薪のほうなので作業者の側で満たす。
   */
  function standingPlayer(): WorldObject {
    const player = spawnInto(SAMPLE_CHARACTER, forest, 'characters');
    makeBrightEnoughForAnyAction(player, codex);
    return player;
  }

  /** 型が宣言している値（インスタンスを1つ作って読む）。 */
  function declaredNumber(objectName: string, propertyId: PropertyGlobalId): number {
    return session.createObject(codex.objectNames.getId(objectName)).getProperty(propertyId).number;
  }

  /** 目方1kgあたりに取り出せる熱（fuel/kg）。 */
  function fuelPerKilogram(objectName: string): number {
    return (declaredNumber(objectName, fuelId) / declaredNumber(objectName, weightId)) * 1000;
  }

  /** 丸太を1本、斧で割る。返すのは割れて出た薪。 */
  function splitOneLog(): WorldObject[] {
    const player = standingPlayer();
    const log = spawnInto('log', forest, 'items');
    const axe = spawnInto('stone_axe', player, 'hand');
    const combination = log.combinationsWith(axe, player).find((c) => c.name === 'split');

    expect(combination, '斧を当てて割る手').toBeDefined();
    expect(combination!.tryExecute()).toBe(true);
    return new Location(forest).items.filter((object) => object.def.name === 'green_firewood');
  }

  /** 薪棚を1つ据える。 */
  function standingRack(): WorldObject {
    return spawnInto('firewood_rack', forest, 'fixtures');
  }

  function stackOn(rack: WorldObject, firewood: readonly WorldObject[]): void {
    const slot = rack.getSlot(codex.slotNames.getId('woodpile'));
    for (const piece of firewood) expect(piece.moveToSlotOrRejection(slot)).toBeUndefined();
  }

  /** 薪棚へ生木の薪をcount本積む。**割る手は通さない**ので、人を立てずに済む。 */
  function rackWithGreenFirewood(count: number): WorldObject {
    const rack = standingRack();
    const pieces = Array.from({ length: count }, () =>
      session.createObject(codex.objectNames.getId('green_firewood')),
    );
    stackOn(rack, pieces);
    return rack;
  }

  function advance(ticks: number): void {
    for (let i = 0; i < ticks; i++) session.advanceWorldTime(TICK_MINUTES);
  }

  /** 棚に積んである薪の型の名前。**乾き上がりは別の型に置き換わる**ので、掴んだ個体では追えない。 */
  function stackedNames(rack: WorldObject): string[] {
    return rack
      .getSlot(codex.slotNames.getId('woodpile'))
      .contents.map((object) => object.def.name)
      .sort();
  }

  it('斧を当てると丸太は薪になり、持っている熱はそのまま', () => {
    // **割っただけでは増えない。** 何本に割れるかも1本ぶんの熱も宣言が持つので、直値では書かない
    // （宣言を動かしても緑のままになる）。
    const firewood = splitOneLog();

    expect(firewood.length, '薪が出る').toBeGreaterThan(1);
    expect(
      firewood.reduce((sum, piece) => sum + piece.getProperty(fuelId).number, 0),
      '割って出た薪の熱の合計は、丸太1本ぶんのまま',
    ).toBe(declaredNumber('log', fuelId));
    expect(
      firewood.reduce((sum, piece) => sum + piece.getProperty(weightId).number, 0),
      '目方も丸太1本ぶんのまま',
    ).toBe(declaredNumber('log', weightId));
  });

  it('割った1本ぶんが、そのまま薪棚の枠に収まる', () => {
    // 棚の広さは丸太1本ぶん（firewood.yamlのwoodpile）。割った薪のほうが多いと、余りは乾かせない。
    const firewood = splitOneLog();
    const rack = standingRack();

    stackOn(rack, firewood);
    expect(stackedNames(rack)).toHaveLength(firewood.length);
  });

  it('尖った石では割れない（斧が要る）', () => {
    const player = standingPlayer();
    const log = spawnInto('log', forest, 'items');
    const knife = spawnInto('sharp_stone', player, 'hand');

    expect(log.combinationsWith(knife, player).map((c) => c.name)).toEqual([]);
  });

  it('薪棚に積めば乾き切って、乾いた薪になる', () => {
    const count = 3;
    const rack = rackWithGreenFirewood(count);
    // 何tickかかるかは薪の宣言が持つので、直値では書かない。
    const ticks = declaredNumber('green_firewood', seasoningRemainingId);

    advance(ticks - 1);
    expect(stackedNames(rack), '1tick足りなければまだ生木').toEqual(Array(count).fill('green_firewood'));
    advance(1);
    expect(stackedNames(rack), '積んだ薪は全部が乾く').toEqual(Array(count).fill('seasoned_firewood'));
  });

  it('棚に積まなければ、いつまでも乾かない', () => {
    // **これが薪棚の値打ち。** 地面へ積んだだけでは、乾きは1tickも進まない。
    const onGround = spawnInto('green_firewood', forest, 'items');
    const ticks = onGround.getProperty(seasoningRemainingId).number;

    advance(ticks * 2);

    expect(onGround.getProperty(seasoningRemainingId).number, '地面の薪は減らない').toBe(ticks);
    expect(onGround.def.name, '型も変わらない').toBe('green_firewood');
  });

  it('乾くと目方が落ちて、出る熱は木から取り出せる上限の率になる', () => {
    // 20 fuel/kgが上限（docs/engine/FireSystem.md 2.5節）。**燃え切らない物は半分**で、細すぎる小枝も
    // 生木の丸太もそちら側に居る。**乾かして届くのは上限までで、超えない。**
    const best = fuelPerKilogram('thick_branch');
    const rateOf = (objectName: string): string =>
      `${objectName}: ${(fuelPerKilogram(objectName) / best).toFixed(2)}`;

    expect(['long_pole', 'seasoned_firewood', 'twig', 'log', 'green_firewood'].map(rateOf)).toEqual([
      'long_pole: 1.00',
      'seasoned_firewood: 1.00',
      'twig: 0.50',
      'log: 0.50',
      'green_firewood: 0.50',
    ]);
    expect(declaredNumber('seasoned_firewood', weightId), '乾けば軽くなる').toBeLessThan(
      declaredNumber('green_firewood', weightId),
    );
  });

  it('乾いた薪1本は、どの炉にもそのまま入り切る（丸太は入り切らない）', () => {
    const hearthTagId = codex.tagNames.getId('hearth');
    const capacities = [...codex.objects]
      .filter((def) => def.hasTag(hearthTagId))
      .map((def) => ({ name: def.name, max: def.tryGetPropertyDef(fuelId)?.range?.max }));
    const seasoned = declaredNumber('seasoned_firewood', fuelId);
    const logFuel = declaredNumber('log', fuelId);

    expect(capacities.length, '炉が1つも出ない').toBeGreaterThan(0);
    expect(
      capacities.filter((hearth) => hearth.max === undefined || hearth.max < seasoned).map((h) => h.name),
      '乾いた薪1本が入らない炉',
    ).toEqual([]);
    // **火を焚く炉はどれも丸太1本を受け切れない**（だから割る値打ちがある）。受け切るのは土器を焼く
    // 使い捨ての覆い焼きの炉だけで、あれは土器しか載らない（pottery.yaml）。
    expect(
      capacities.filter((hearth) => (hearth.max ?? 0) >= logFuel).map((h) => h.name),
      '丸太1本を受け切れる炉',
    ).toEqual(['earth_kiln']);
  });

  it('乾いた薪は、燃料1点あたりの手間が拾った枝より安い', () => {
    // **これが山として立っている理由**（docs/world/ContentSkeleton.md 4節）。棚を据える手間を払って
    // 初めて、伐った木が拾った枝より安い燃料になる。
    const balance = buildBalanceTables(codex, SAMPLE_CHARACTER);
    const minutesPerFuel = (objectName: string): number => {
      const cost = balance.objectCosts.find((row) => row.objectName === objectName);
      expect(cost?.minutes, `${objectName}の総コスト`).toBeGreaterThan(0);
      return cost!.minutes! / declaredNumber(objectName, fuelId);
    };

    expect(minutesPerFuel('seasoned_firewood'), '拾った枝より安い').toBeLessThan(
      minutesPerFuel('thick_branch'),
    );
    expect(minutesPerFuel('seasoned_firewood'), '乾かす前より安い').toBeLessThan(
      minutesPerFuel('green_firewood'),
    );
  });
});
