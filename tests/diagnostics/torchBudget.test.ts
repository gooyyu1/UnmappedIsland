import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  activityHoursOf,
  litPlacesOf,
  worldAmbientBrightnessOf,
  type LitPlace,
  type SeasonWeatherHours,
} from '../../src/analysis/activityHours';
import { carriedLightOf } from '../../src/analysis/carriedLight';
import type { SkyState } from '../../src/analysis/skyState';
import type { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { makeBrightEnoughForAnyAction } from '../support/illumination';
import { fixedRng } from '../support/rng';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { HOURS_PER_DAY, MINUTES_PER_DAY, MINUTES_PER_TICK } from '../../src/domain/worldTime';
import { bundledCodex, SAMPLE_CHARACTER } from '../support/worldCodexFiles';

/**
 * 松明1本が何を開き、そのために何分払うのかの検査（`ContentSkeleton.md` 8.1.1.4節）。
 *
 * **活動時間表（`stats/climate.yaml`の`activity_hours`）は光源を数えない**ので、「松明を持てば
 * どうなるか」はその表の外側にある。ここが測るのはその補集合で、同じ切り方（土地×季節×時刻×天気を
 * しきい値で切る）へ光源の段数だけを足して出す。
 *
 * 同節が書いた数のうち、**割り算の結果はレポートのどのセルでもない**——明かり1分あたりの手間も、
 * 往復に要る本数も、燃焼時間と手間と道の長さが揃って初めて出る。出どころの印
 * （`tests/docs/docStatsCitations.test.ts`）はセルの書き写ししか見ないので、そこはここが持つ。
 */

const ROOT = join(__dirname, '..', '..');

function statsReport(fileName: string): Record<string, readonly Record<string, unknown>[]> {
  return parse(readFileSync(join(ROOT, 'stats', fileName), 'utf-8')) as Record<
    string,
    readonly Record<string, unknown>[]
  >;
}

/** その節の、セレクタを満たす唯一のレコードの数値。1件に定まらなければ落とす。 */
function cell(
  report: Record<string, readonly Record<string, unknown>[]>,
  section: string,
  selector: Record<string, unknown>,
  column: string,
): number {
  const matched = (report[section] ?? []).filter((record) =>
    Object.entries(selector).every(([key, value]) => record[key] === value),
  );
  expect(matched, `${section} の ${JSON.stringify(selector)} が1件に定まらない`).toHaveLength(1);
  const value = matched[0][column];
  expect(typeof value, `${section}.${column} が数でない`).toBe('number');
  return value as number;
}

const SKELETON_DOC = readFileSync(join(ROOT, 'docs', 'world', 'ContentSkeleton.md'), 'utf-8');

/** 文書の、その正規表現が捕らえた数。捕まらなければ落とす（書き換えで数が消えたことも壊れた状態）。 */
function numberIn(text: string, pattern: RegExp, label: string): number {
  const matched = pattern.exec(text);
  expect(matched, `${label} が文書から読めない（${String(pattern)}）`).not.toBeNull();
  return Number.parseFloat(matched![1]);
}

/**
 * 松明が燃え続ける分数。`life` の上限（tick）を暦の刻みへ直したもので、
 * **どちらを動かしても付いてくる**。
 */
function torchBurnMinutesOf(codex: WorldCodex): number {
  const torch = codex.objects.get(codex.objectNames.getId('torch'));
  const life = torch.tryGetPropertyDef(codex.propertyNames.getId('life'));
  expect(life?.range, '松明が燃え残り（life）のrangeを宣言している').toBeDefined();
  return life!.range!.max * MINUTES_PER_TICK;
}

/**
 * 天気を等しい重みで並べた季節1つ。**出現時間の実測は要らない**——ここで見たいのは「どの時刻の
 * どの天気でも開くか」で、1つでも閉じる組み合わせがあれば時間が24を割る、という形で読む。
 * 等重みにするのは、重み0の組み合わせを作らないため。
 */
function everyWeatherEqually(codex: WorldCodex): readonly SeasonWeatherHours[] {
  const names = weatherNamesOf(codex);
  return [
    {
      seasonName: 'すべての天気',
      durationDays: names.length,
      hoursByWeather: new Map(names.map((name) => [name, 24])),
    },
  ];
}

/** 宣言されている天気の段の名前。 */
function weatherNamesOf(codex: WorldCodex): readonly string[] {
  const world = codex.objects.get(codex.objectNames.getId('world'));
  const weatherDef = world.tryGetPropertyDef(codex.vocabulary.world.weatherId);
  expect(weatherDef?.stages.length, 'worldが天気の段を宣言している').toBeGreaterThan(0);
  return weatherDef!.stages.map((stage) => stage.name);
}

/** その天気しか出ない季節。**どの天気が閉じているのか**を、1つずつ切り分けて見るために使う。 */
function onlyThisWeather(weatherName: string): readonly SeasonWeatherHours[] {
  return [{ seasonName: weatherName, durationDays: 1, hoursByWeather: new Map([[weatherName, 24]]) }];
}

describe('松明1本が買うもの（ContentSkeleton.md 8.1.1.4節）', () => {
  const codex = bundledCodex();
  const torch = carriedLightOf(codex, 'torch');
  const places = litPlacesOf(codex);
  const worldAmbientAt = worldAmbientBrightnessOf(codex);
  // 屋根の下でない場所の行動を、明るさに依らず止める天気（ContentSkeleton.md 8.1.4節）。
  // **どこでも灯っていて暗さを埋め切る仮の明かり**で数えるので、残る閉じ方は風雨だけ
  // ——暗さで閉じた時間と混ざらない。
  const neverDark = { ev: torch.ev * 10, staysLitUnder: (): boolean => true };
  const galeWeathers = new Set(
    weatherNamesOf(codex).filter((weatherName) =>
      activityHoursOf(codex, onlyThisWeather(weatherName), neverDark).some(
        (row) => row.travelHoursPerDay < HOURS_PER_DAY - 1e-6,
      ),
    ),
  );

  function placeNamed(name: string): LitPlace {
    const place = places.find((candidate) => candidate.name === name);
    if (place === undefined) throw new Error(`${name} が明るさを解ける場所に無い`);
    return place;
  }

  /** その土地のその天気で、松明から見た空（時刻は灯っていられるかに効かないので正午で代表させる）。 */
  function skyAt(locationName: string, weatherName: string): SkyState {
    const place = placeNamed(locationName);
    return {
      weatherSymbolId: codex.symbolNames.tryGetId(weatherName),
      ambientBrightness: place.brightnessAt(worldAmbientAt(12, weatherName)),
      sheltered: place.shelteredValue,
    };
  }

  const burnMinutes = torchBurnMinutesOf(codex);
  const balance = statsReport('balance.yaml');
  const terrain = statsReport('terrain.yaml');
  const torchCostMinutes = cell(balance, 'object_costs', { object: 'torch' }, 'total_minutes');

  it('灯っていられるあいだは、どの土地のどの時刻も開く', () => {
    // 灯っていられるかは場所の屋根と天気だけで決まり、時刻を見ない（下の「エンジンと一致する」）。
    // 天気を1つずつ立てて、**灯っていられる組み合わせだけ**を見る——雨の屋外で消えた松明の時間は、
    // 松明が開けた時間ではない（FireSystem.md 8.2節）。
    let litCombinations = 0;
    for (const weatherName of weatherNamesOf(codex)) {
      for (const row of activityHoursOf(codex, onlyThisWeather(weatherName), torch)) {
        if (!torch.staysLitUnder(skyAt(row.locationName, weatherName))) continue;
        litCombinations++;
        const where = `${row.locationName}・${weatherName}`;
        // 明るさのほうは松明が埋め切るので、**列の間に残る差は風雨だけ**（下の嵐）。
        const expected = galeWeathers.has(weatherName) && !placeNamed(row.locationName).sheltered ? 0 : 24;
        expect(row.travelHoursPerDay, `${where}: 移動`).toBeCloseTo(expected, 6);
        expect(row.outdoorSearchHoursPerDay, `${where}: 屋外で見て探す`).toBeCloseTo(expected, 6);
        expect(row.handworkHoursPerDay, `${where}: 手元の作業`).toBeCloseTo(expected, 6);
      }
    }
    expect(litCombinations, '松明が灯っていられる土地と天気が1つも無い').toBeGreaterThan(0);
  });

  it('嵐は明るさではなく風雨で屋外を閉じる——屋根の下だけが開く', () => {
    // ContentSkeleton.md 8.1.4節。松明が買えるのは暗さで閉じた分だけで、風雨で閉じた分は買えない。
    expect([...galeWeathers], '屋外を風雨で閉じる天気').toEqual(['storm']);

    const inStorm = activityHoursOf(codex, onlyThisWeather('storm'), torch);
    expect(
      inStorm.some((row) => row.travelHoursPerDay > HOURS_PER_DAY - 1e-6),
      '嵐でも開く土地が1つも無い（風雨の届かない土地が消えた）',
    ).toBe(true);
  });

  it('灯っていられない雨の屋外では、松明を持たないのと同じだけしか開かない', () => {
    let unlitCombinations = 0;
    for (const weatherName of weatherNamesOf(codex)) {
      const without = activityHoursOf(codex, onlyThisWeather(weatherName));
      for (const [index, row] of activityHoursOf(codex, onlyThisWeather(weatherName), torch).entries()) {
        if (torch.staysLitUnder(skyAt(row.locationName, weatherName))) continue;
        unlitCombinations++;
        const where = `${row.locationName}・${weatherName}`;
        expect(row.travelHoursPerDay, `${where}: 移動`).toBeCloseTo(without[index].travelHoursPerDay, 6);
        expect(row.outdoorSearchHoursPerDay, `${where}: 屋外で見て探す`).toBeCloseTo(
          without[index].outdoorSearchHoursPerDay,
          6,
        );
        expect(row.handworkHoursPerDay, `${where}: 手元の作業`).toBeCloseTo(
          without[index].handworkHoursPerDay,
          6,
        );
      }
    }
    // 空振り防止。消える条件を読めなくなると、上は1つも比べずに緑のまま通る。
    expect(unlitCombinations, '松明が消える土地と天気が1つも無い（FireSystem.md 8.2節）').toBeGreaterThan(0);
  });

  it('松明が灯っていられるかの読みは、エンジンで手に持った松明と一致する', () => {
    // 診断が数える前提（どこで灯っていられるか）を、規則そのもの（fire.yamlの宣言をエンジンが回した
    // 結果）と突き合わせる。**宣言の読み方がずれても、宣言が変わっても**、ここで食い違いが出る。
    const litId = codex.propertyNames.getId('lit');
    const hourId = codex.vocabulary.world.hourId;
    const weatherId = codex.vocabulary.world.weatherId;
    for (const place of places) {
      for (const weatherName of weatherNamesOf(codex)) {
        const session = new WorldSession(codex, fixedRng(0));
        const world = session.createWorld().instance;
        const spawnInto = (objectName: string, parent: WorldObject, slotName: string): WorldObject => {
          const spawned = session.createObject(codex.objectNames.getId(objectName));
          expect(
            spawned.moveToSlotOrRejection(parent.getSlot(codex.slotNames.getId(slotName))),
          ).toBeUndefined();
          return spawned;
        };
        world.getProperty(weatherId).setNumberWithoutEvents(codex.symbolNames.getId(weatherName));

        const cave = place.name === 'shallow_cave';
        const land = spawnInto(cave ? 'grassland' : place.name, world, 'locations');
        const player = spawnInto(SAMPLE_CHARACTER, land, 'characters');
        makeBrightEnoughForAnyAction(player, codex);
        if (cave) {
          const shelter = spawnInto('shallow_cave', land, 'fixtures');
          expect(shelter.tryGetAction('enter', player)?.tryExecute(), '浅い洞窟へ入る').toBe(true);
        }
        const torchInHand = spawnInto('torch', player, 'hand');
        torchInHand.getProperty(litId).setNumberWithoutEvents(1);

        const hour = world.getProperty(hourId).number;
        const expected = torch.staysLitUnder({
          weatherSymbolId: codex.symbolNames.tryGetId(weatherName),
          ambientBrightness: place.brightnessAt(worldAmbientAt(hour, weatherName)),
          sheltered: place.shelteredValue,
        });
        session.advanceWorldTime(MINUTES_PER_TICK);

        expect(torchInHand.getProperty(litId).number === 1, `${place.name}・${weatherName}`).toBe(expected);
      }
    }
  });

  it('1段下げると手元の作業だけが閉じる——+11 はそこでしか置けない', () => {
    const seasons = everyWeatherEqually(codex);
    const lit = activityHoursOf(codex, seasons, torch);
    const dimmer = activityHoursOf(codex, seasons, { ...torch, ev: torch.ev - 1 });

    // 「手元の作業だけ」を言うには、残りが動いていないことを1つ残らず見る必要がある
    // ——採取のしきい値（+3）だけを動かしても、そちらを見ていなければ緑のまま主張が嘘になる。
    for (const [index, row] of dimmer.entries()) {
      const where = `${row.locationName}`;
      expect(row.travelHoursPerDay, `${where}: 移動`).toBeCloseTo(lit[index].travelHoursPerDay, 6);
      expect(row.outdoorSearchHoursPerDay, `${where}: 屋外で見て探す`).toBeCloseTo(
        lit[index].outdoorSearchHoursPerDay,
        6,
      );
    }
    expect(
      dimmer.some((row, index) => row.handworkHoursPerDay < lit[index].handworkHoursPerDay - 1e-6),
      '1段下げても手元の作業が閉じない土地が1つも無い',
    ).toBe(true);
  });

  it('キャラクタ側の明るさはrangeを持たない——持つと、足した光源が頭打ちになる', () => {
    for (const def of codex.objects) {
      if (!def.hasTag(codex.vocabulary.world.characterTagId)) continue;
      for (const propertyName of ['hand_brightness', 'looking_brightness']) {
        const propertyDef = def.tryGetPropertyDef(codex.propertyNames.getId(propertyName));
        expect(propertyDef?.range, `${def.name} の ${propertyName} がrangeを持っている`).toBeUndefined();
      }
    }
  });

  it('火種から灯すと、1本の手間が燃える時間を超える', () => {
    const tinderCostMinutes = cell(balance, 'object_costs', { object: 'burning_tinder' }, 'total_minutes');
    const written = numberIn(SKELETON_DOC, /合わせて([\d.]+)分/, '火種から灯した1本の手間');

    expect(torchCostMinutes + tinderCostMinutes).toBeCloseTo(written, 1);
    expect(written, '火種から灯す道だけなら、燃える時間より長い').toBeGreaterThan(burnMinutes);
    expect(torchCostMinutes, '炉から分けてもらえば、燃える時間より短い').toBeLessThan(burnMinutes);
  });

  it('燃えるのは2時間で、文書もそう書いている', () => {
    expect(burnMinutes).toBe(120);
    expect(
      /松明1本は2時間で/.test(SKELETON_DOC),
      'ContentSkeleton.md 8.1.1.4節の見出しが燃焼時間を2時間と書いている',
    ).toBe(true);
  });

  it('明かり1分あたりの手間が、文書の書いた比と合う', () => {
    const written = numberIn(SKELETON_DOC, /明かり1分あたり([\d.]+)分/, '明かり1分あたりの手間');
    expect(torchCostMinutes / burnMinutes).toBeCloseTo(written, 2);
  });

  it('日が暮れてから拠点へ往復するなら2本要る（1本では帰り着けない）', () => {
    const written = numberIn(SKELETON_DOC, /日が暮れてから往復するなら(\d+)本/, '往復に要る本数');
    const roundTripMinutes = cell(terrain, 'base_one_way', { base: 'shortest_mean' }, 'mean') * 2;

    expect(burnMinutes * (written - 1), '1本少なければ足りない').toBeLessThan(roundTripMinutes);
    expect(burnMinutes * written, 'その本数で足りる').toBeGreaterThanOrEqual(roundTripMinutes);
  });

  it('光源を持たない1日は、起きているあいだが既に埋まっている', () => {
    const budget = (column: string): number => cell(terrain, 'daily_budget', {}, column);

    // レポートは0.1分で丸めて出すので、和は丸めの幅だけずれうる。
    expect(
      budget('outdoor_window') + budget('night_craft') + budget('storm_stop') + budget('sleep'),
      '屋外の窓・炉端・嵐で止まる時間・睡眠で1日がちょうど埋まる（松明の入る先が無い）',
    ).toBeCloseTo(MINUTES_PER_DAY, 0);
  });
});
