import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { World } from '../../src/domain/wrappers/World';
import { bundledCodex, SAMPLE_CHARACTER } from '../support/worldCodexFiles';
import { makeBrightEnoughForAnyAction } from '../support/illumination';

/**
 * 土地が空の気温へ足す海抜ぶんの差（[`docs/engine/ClimateSystem.md`](../../docs/engine/ClimateSystem.md)
 * 1.1節）を、実ファイルの定義だけで検証する。
 *
 * **この差が在ることで、寒さを防ぐ物の段が1つずつ別の土地で釣り合う**（同節・`SurvivalItems.md` 5.1節）。
 * 空だけでは素の入口16℃を下回る刻みが2つしかなく、衣類の段のほうが細かい——どれか1つの土地から
 * 差を落とせば、その段が隣と見分けられなくなって下の2本目が落ちる。
 */

const ROOT = resolve(__dirname, '../..');

/** 気温減率。国際標準大気の1,000mあたり6.5℃（ClimateSystem.md 1.1節）。 */
const LAPSE_RATE_PER_METER = 6.5 / 1000;

/** 生成した島の実測（stats/terrain.yaml）。土地の型 → 平均海抜（m）。 */
const MEAN_ELEVATION: ReadonlyMap<string, number> = new Map(
  (
    parse(readFileSync(resolve(ROOT, 'stats/terrain.yaml'), 'utf-8')) as {
      site_elevation_by_location: readonly { location: string; mean: number }[];
    }
  ).site_elevation_by_location.map(({ location, mean }) => [location, mean]),
);

/** その海抜で、空より何℃低いか。 */
function lapse(meters: number): number {
  return Math.round(meters * LAPSE_RATE_PER_METER);
}

/** 空の気温そのものを持つのはworldで、そこは土地の差の対象ではない（ClimateSystem.md 1節）。 */
const SKY = 'world';

describe('土地が空の気温へ足す、海抜ぶんの差', () => {
  let codex: WorldCodex;
  let session: WorldSession;
  let world: WorldObject;
  let player: WorldObject;
  let lands: Map<string, WorldObject>;

  beforeAll(() => {
    // 土地・衣類・キャラクタが別々のファイルに散っているため、ディレクトリ全体を一括ロードする。
    codex = bundledCodex();
  });

  function spawn(objectName: string): WorldObject {
    return session.createObject(codex.objectNames.getId(objectName));
  }

  function property(object: WorldObject, name: string) {
    return object.getProperty(codex.propertyNames.getId(name));
  }

  beforeEach(() => {
    session = new WorldSession(codex);
    world = session.createObject(codex.objectNames.getId(SKY));
    session.adoptWorld(new World(world));

    lands = new Map();
    for (const name of MEAN_ELEVATION.keys()) {
      const land = spawn(name);
      expect(
        land.moveToSlotOrRejection(world.getSlot(codex.slotNames.getId('locations'))),
        name,
      ).toBeUndefined();
      lands.set(name, land);
    }

    player = spawn(SAMPLE_CHARACTER);
  });

  /** キャラクタをその土地へ立たせる。熱の削りは祖先の気温を読むので、居場所が要る。 */
  function standIn(landName: string): void {
    expect(
      player.moveToSlotOrRejection(lands.get(landName)!.getSlot(codex.slotNames.getId('characters'))),
      landName,
    ).toBeUndefined();
  }

  /**
   * 涼しい季節（thermal_levelの下限）の、その時刻の空を組み立てる。**気温は書き写さずにcore.yamlから
   * 引く**ので、季節や日射の寄与を動かせばここを読む側が落ちる。日射の帯（ambient_brightnessの段）は
   * 名前で確かめてから返すので、時刻の側が動いても気づける。
   */
  function coolSeasonSky(hour: number, brightnessStage: string): number {
    property(world, 'thermal_level').setNumber(0);
    property(world, 'hour').setNumber(hour);
    property(world, 'weather').setNumberWithoutEvents(codex.symbolNames.getId('clear'));
    expect(
      property(world, 'ambient_brightness').isInStage(brightnessStage),
      `${hour}時の空が${brightnessStage}の帯にある`,
    ).toBe(true);

    return property(world, 'ambient_temperature').getEffectiveValue();
  }

  /** その土地の今の気温（℃）。 */
  function temperatureAt(landName: string): number {
    return property(lands.get(landName)!, 'ambient_temperature').getEffectiveValue();
  }

  /** 今の空と居場所で、1 tick置いたときの熱の増減。満タンだと戻りが頭打ちに掛かるので半分から測る。 */
  function warmthChange(): number {
    const warmth = property(player, 'warmth');
    warmth.setNumber((warmth.def.range?.max ?? 0) / 2);
    const before = warmth.number;

    player.tick();

    return warmth.number - before;
  }

  /** 身につけられる物と、それが押し下げた先の寒さの入口（℃）。浅い順。 */
  function garmentThresholds(): { readonly name: string; readonly threshold: number }[] {
    const equippableId = codex.tagNames.getId('equippable');
    const garments = [...codex.objects]
      .filter((objectDef) => !codex.isGenerated(objectDef) && objectDef.tags.includes(equippableId))
      .map((objectDef) => objectDef.name);

    return garments
      .map((name) => {
        const wearer = spawn(SAMPLE_CHARACTER);
        expect(
          spawn(name).moveToSlotOrRejection(wearer.getSlot(codex.vocabulary.world.equipmentSlotId)),
          name,
        ).toBeUndefined();
        return { name, threshold: property(wearer, 'chill_point').getEffectiveValue() };
      })
      .sort((left, right) => right.threshold - left.threshold);
  }

  it.each([...MEAN_ELEVATION].map(([name, meters]) => ({ name, meters })))(
    '$name の気温は、平均海抜ぶんだけ空より低い',
    ({ name, meters }) => {
      const sky = coolSeasonSky(12, 'bright');

      expect(sky - temperatureAt(name), `平均海抜${meters}m`).toBe(lapse(meters));
    },
  );

  it('海抜ぶんの差を宣言しているのは、丸めて0にならない土地だけ', () => {
    // 差の出どころは海抜1つだけ（ClimateSystem.md 1.1節）。ここを通さずに置いた差——たとえば
    // 「洞窟の中は暖かい」を定数で足したもの——は、この検査が拾う。
    const temperatureId = codex.propertyNames.getId('ambient_temperature');
    const declared = [...codex.objects].filter(
      (objectDef) =>
        !codex.isGenerated(objectDef) &&
        objectDef.name !== SKY &&
        objectDef.tryGetPropertyDef(temperatureId) !== undefined,
    );

    for (const objectDef of declared) {
      const elevation = MEAN_ELEVATION.get(objectDef.name);
      // 実体値（自分の差）で見る。実効値は祖先の空を含むので、差だけを取り出せない。
      expect(property(spawn(objectDef.name), 'ambient_temperature').number, objectDef.name).toBe(
        elevation === undefined ? 0 : 0 - lapse(elevation),
      );
    }
  });

  it('寒さを防ぐ物は、1段ごとに別の土地で釣り合う', () => {
    // 涼しい季節の薄明（＝雨天の昼と同じ帯）が、土地の差で1℃ずつに割れる。段の数だけ刻みが要る
    // ——どれか1つでも同じ土地に重なれば、その2段は見分けが付かない（issue #2147）。
    const dimSky = coolSeasonSky(6, 'dim');
    const matching = new Map<string, string>();

    for (const { name, threshold } of garmentThresholds()) {
      const land = [...lands.keys()].find((landName) => temperatureAt(landName) === threshold);

      expect(land, `${name}（入口${threshold}℃）と釣り合う土地。空は${dimSky}℃`).toBeDefined();
      expect(matching.get(land!), `${land}は${matching.get(land!)}と重なっている`).toBeUndefined();
      matching.set(land!, name);
    }
  });

  it('1段深い一着は、1段高い土地で結果を変える', () => {
    coolSeasonSky(6, 'dim');
    const thresholds = garmentThresholds();
    const equipmentId = codex.vocabulary.world.equipmentSlotId;
    const handId = codex.vocabulary.world.handSlotId;

    for (const [index, { name, threshold }] of thresholds.entries()) {
      const land = [...lands.keys()].find((landName) => temperatureAt(landName) === threshold);
      expect(land, `${name}（入口${threshold}℃）と釣り合う土地`).toBeDefined();
      standIn(land!);

      // 1段浅い一着（いちばん浅い一着なら素のまま）では、この土地で削られる。
      const shallower = index === 0 ? undefined : thresholds[index - 1].name;
      const worn = shallower === undefined ? undefined : spawn(shallower);
      if (worn !== undefined)
        expect(worn.moveToSlotOrRejection(player.getSlot(equipmentId)), shallower).toBeUndefined();
      expect(warmthChange(), `${land}（${threshold}℃）では${shallower ?? '素のまま'}で削られる`).toBeLessThan(
        0,
      );

      // 着替えれば、同じ土地の同じ空で削られなくなる。
      if (worn !== undefined) expect(worn.moveToSlotOrRejection(player.getSlot(handId))).toBeUndefined();
      const deeper = spawn(name);
      expect(deeper.moveToSlotOrRejection(player.getSlot(equipmentId)), name).toBeUndefined();
      expect(warmthChange(), `${land}（${threshold}℃）では${name}で戻る`).toBeGreaterThan(0);

      // 次の土地へ移る前に脱ぐ。
      expect(deeper.moveToSlotOrRejection(player.getSlot(handId))).toBeUndefined();
    }
  });

  /**
   * いちばん深い一着を着せる（押し下げがいちばん大きい＝入口がいちばん低い一着）。**寝床の押し下げは
   * これと加算で重なる**（docs/world/Bedding.md 4.2節）ので、寝床が伸ばす先はここから測る。
   */
  function wearDeepestGarment(): string {
    const thresholds = garmentThresholds();
    const deepest = thresholds[thresholds.length - 1];
    expect(
      spawn(deepest.name).moveToSlotOrRejection(player.getSlot(codex.vocabulary.world.equipmentSlotId)),
      deepest.name,
    ).toBeUndefined();

    return deepest.name;
  }

  /**
   * その土地に骨組みを差した寝台を据え、涼しい季節の夜に1回眠る間に動いた熱（kcal）。満タンだと
   * 戻りが頭打ちに掛かるので半分から測る。
   *
   * **測るのは仮眠。** 通しの睡眠（6時間）は0時から始めると日射の帯を跨いで気温が動く（`core.yaml` の
   * `ambient_brightness` の段）。押し下げは境目への寄与で長さに比例しないので、削られるか戻るかは
   * どちらでも同じに決まる（`bedding.yaml` は nap と sleep へ同じ量を書く）。
   */
  function warmthWhileSleepingIn(landName: string): number {
    coolSeasonSky(0, 'dark');
    standIn(landName);
    makeBrightEnoughForAnyAction(player, codex);

    const bed = spawn('bed');
    expect(
      bed.moveToSlotOrRejection(lands.get(landName)!.getSlot(codex.slotNames.getId('fixtures'))),
      landName,
    ).toBeUndefined();
    expect(
      spawn('bed_frame').moveToSlotOrRejection(bed.getSlot(codex.slotNames.getId('structure'))),
      landName,
    ).toBeUndefined();

    const warmth = property(player, 'warmth');
    warmth.setNumber((warmth.def.range?.max ?? 0) / 2);
    const before = warmth.number;
    const celsius = temperatureAt(landName);

    expect(bed.tryGetAction('nap', player)?.tryExecute(), landName).toBe(true);

    // **眠っている間に気温が動いていないことを確かめる。** 動いていれば、測った熱は据えた気温での
    // 増減ではなく混ざりもので、釣り合いを見たことにならない（涼しい季節の下限へ張り付けているので
    // 季節の段は動かず、夜の帯は翌6時まで続く）。
    expect(temperatureAt(landName), `眠っている間、${landName}は${celsius}℃のまま`).toBe(celsius);

    return warmth.number - before;
  }

  it('いちばん深い一着と骨組みを差した寝台で越せないのは、最も寒い土地の夜だけ', () => {
    // docs/world/Bedding.md 4.2節。衣類だけで釣り合うのは海沿いの夜まで（SurvivalItems.md 5.1節）で、
    // そこから上へ登れるかは寝床の段が決める。**最も寒い土地の夜はどの段でも越せない**——そこに
    // 残るのは火（FireSystem.md 9.2節の炉の暖）。
    coolSeasonSky(0, 'dark');
    const byCold = [...lands.keys()].sort((left, right) => temperatureAt(left) - temperatureAt(right));
    const coldest = byCold[0];
    const nextColdest = byCold.find((name) => temperatureAt(name) > temperatureAt(coldest))!;
    const garment = wearDeepestGarment();

    expect(
      warmthWhileSleepingIn(nextColdest),
      `${garment}を着て寝台で眠れば${nextColdest}の夜は越せる`,
    ).toBeGreaterThan(0);
    expect(
      warmthWhileSleepingIn(coldest),
      `${garment}を着て寝台で眠っても${coldest}の夜は越せない`,
    ).toBeLessThan(0);
  });

  it('素のままでも晴れた日中に熱は戻る——山頂を除く', () => {
    // 刻みを増やしても「何も着ず火も無いままでは越せない日が続く」形にしない（issue #2147）。
    // 戻りは削りの4倍なので、日中に入口を上回りさえすればその日のうちに戻る。
    coolSeasonSky(12, 'bright');
    const coldest = [...lands.keys()].reduce((left, right) =>
      temperatureAt(left) <= temperatureAt(right) ? left : right,
    );

    for (const landName of lands.keys()) {
      standIn(landName);
      const change = warmthChange();

      if (landName === coldest) expect(change, `${landName}は素のままでは戻らない`).toBeLessThan(0);
      else expect(change, `${landName}なら素のままでも戻る`).toBeGreaterThan(0);
    }

    // その山頂も、いちばん安い一着があれば戻る。
    standIn(coldest);
    const [shallowest] = garmentThresholds();
    expect(
      spawn(shallowest.name).moveToSlotOrRejection(player.getSlot(codex.vocabulary.world.equipmentSlotId)),
      shallowest.name,
    ).toBeUndefined();

    expect(warmthChange(), `${coldest}でも${shallowest.name}があれば戻る`).toBeGreaterThan(0);
  });
});
