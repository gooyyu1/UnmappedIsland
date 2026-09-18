import { describe, expect, it } from 'vitest';
import type { PlaceBalance } from '../../src/analysis/balanceTables';
import { buildBalanceTables, WHOLE_ISLAND } from '../../src/analysis/balanceTables';
import { bundledCodex, SAMPLE_CHARACTER } from '../support/worldCodexFiles';

/**
 * 同梱の定義に対して、土地ごとの連鎖表（`chain_routes`）が、その土地で完結する経路を落とさないこと
 * （issue #2285）。
 *
 * 土地の文脈は材料の出どころを「この土地 → 他の土地から持ち込み」の順で選ぶが、選び直しの比較が
 * 安さしか見ていないと、**島のどこかに1分安い産地が在るというだけで、その土地の産地が持ち込みに
 * 差し替わる**。差し替わった経路は `rootedHere` が偽になって土地の表から丸ごと落ちるので、罠で獣が
 * 獲れる土地に、その獣の経路が1本も出なくなる（BalanceStats.md「連鎖表」の `imported`）。
 *
 * **合成YAMLでは出ない形。** 出どころが2つ在って、土地の側がわずかに高いという組み合わせが要る
 * ——同梱の定義では、くくり罠の掛かりやすさが土地ごとに違うことがそれを作っている。
 */
describe('土地で完結する経路は、土地の表に出る', () => {
  const tables = buildBalanceTables(bundledCodex(), SAMPLE_CHARACTER);
  const islandWide = tables.places.find((place) => place.name === WHOLE_ISLAND)!;
  const lands = tables.places.filter((place) => place.name !== WHOLE_ISLAND);

  /** その表の経路が通っている待ち生産（`設備.工程`）。 */
  function devicesOnRoutes(place: PlaceBalance): Set<string> {
    const found = new Set<string>();
    for (const property of place.properties)
      for (const { route } of property.routes)
        for (const device of route.devices) found.add(`${device.deviceName}.${device.stepName}`);
    return found;
  }

  it('その土地で作れて朽ちる設備は、その土地の経路にも出る', () => {
    // 島全体で経路にならない設備（産物が需要のどれも埋めない・もっと安い設備に押し出される）は、
    // 土地の側に出ないのが正しい。**その土地で作れて按分もできる**のに落ちているものだけを挙げる。
    const onIslandRoutes = devicesOnRoutes(islandWide);
    const missing: string[] = [];

    for (const land of lands) {
      const onLandRoutes = devicesOnRoutes(land);
      for (const device of land.devices) {
        if (device.buildMinutes === undefined || device.laborPerUnit === undefined) continue;
        const key = `${device.deviceName}.${device.stepName}`;
        if (!onIslandRoutes.has(key) || onLandRoutes.has(key)) continue;
        missing.push(`${land.name}: ${key} → ${device.productName}`);
      }
    }

    expect(missing).toEqual([]);
  });

  it('朽ちない設備は、獲れる土地でも経路にならない', () => {
    // 囲いは寿命を持たないので1周期ぶんを按分できず、産物は値段の付かない側になる（BalanceStats.md
    // 「待って得る生産の数え方」）。**上の見張りが朽ちる設備だけを見ている理由**がこれで、囲いの行が
    // 経路に出ないのは落ちているのではない。
    const pens = [islandWide, ...lands].flatMap((place) =>
      place.devices.filter((device) => device.deviceName === 'pen'),
    );

    expect(pens.length).toBeGreaterThan(0);
    expect(pens.filter((pen) => pen.laborPerUnit !== undefined)).toEqual([]);
    expect([...devicesOnRoutes(islandWide)].filter((key) => key.startsWith('pen.'))).toEqual([]);
  });

  it('その土地の産地のほうが高くても、持ち込みに差し替わらない', () => {
    // くくり罠のネズミは、山腹（rat_catch 4）より草原（同 6）のほうが掛かりやすいので、島のどこかで
    // 獲るほうが安い。安いほうを採ると山腹の経路が持ち込み扱いになって表から落ちる。
    const perUnit = (placeName: string): number => {
      const place = tables.places.find((candidate) => candidate.name === placeName)!;
      const rat = place.devices.find(
        (device) => device.deviceName === 'snare' && device.productName === 'rat',
      )!;
      return rat.laborPerUnit!;
    };

    expect(perUnit('mountainside')).toBeGreaterThan(perUnit(WHOLE_ISLAND));

    const mountainside = tables.places.find((place) => place.name === 'mountainside')!;
    const viaSnare = mountainside.properties
      .filter((property) => property.propertyName === 'satiety')
      .flatMap((property) => property.routes)
      .filter(({ route }) => route.devices.some((device) => device.deviceName === 'snare'));

    expect(viaSnare.length).toBeGreaterThan(0);
    expect(viaSnare.map(({ route }) => route.needsImport)).not.toContain(true);
  });
});

/**
 * `unmet`（その土地に留まって賄えなかった値）が、**「その値を返す物がこの土地に無い」を意味しない**
 * こと（BalanceStats.md「1日を賄う最小労働」）。同梱の定義では、賄えないと出る値はどれも
 * 「在るが、朽ちない設備の待ち生産なので値段が付かない」側にある。
 *
 * 読み分けるのは `devices` の側なので、そこに行が在ることまで見ないと、この読み分けは示せない。
 */
describe('unmet が意味すること', () => {
  const tables = buildBalanceTables(bundledCodex(), SAMPLE_CHARACTER);
  const islandWide = tables.places.find((place) => place.name === WHOLE_ISLAND)!;
  const lands = tables.places.filter((place) => place.name !== WHOLE_ISLAND);

  it('空心菜のビタミンは、島全体では値段の付く経路になる', () => {
    // 次の見張りが「畑の空心菜」を `vitamin` の出どころとして数えられる根拠。探索で採れる土地では
    // 値段が付くので、畑の行が値段を付けられないのは畑が朽ちないからだと言える。
    const vitamin = islandWide.properties.find((property) => property.propertyName === 'vitamin')!;

    expect(vitamin.routes.map(({ route }) => route.steps.at(-1)?.objectName)).toContain('water_spinach');
  });

  it('ビタミンが賄えないと出る土地でも、畑は作れる', () => {
    // 畑は朽ちないので1周期ぶんを按分できず（「待って得る生産の数え方」）、そこから穫れる空心菜は
    // 献立に載らない。**つまりこの `unmet` は「ビタミンを返す物が無い」ではない。**
    const short = lands.filter((land) => land.menu.unmet.includes('vitamin'));

    expect(short.map((land) => land.name).length).toBeGreaterThan(0);
    for (const land of short) {
      const unpriced = land.devices.filter(
        (device) => device.buildMinutes !== undefined && device.laborPerUnit === undefined,
      );
      expect(unpriced.map((device) => device.productName)).toContain('water_spinach');
    }
  });
});
