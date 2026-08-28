import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { startNewGame } from '../../src/domain/generation/NewGame';
import type { StartedGame } from '../../src/domain/generation/NewGame';
import type { WorldObject } from '../../src/domain/WorldObject';
import { applyScenario, bundledScenario } from '../../src/scenario/Scenario';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';
import { seededRng } from '../../src/domain/Rng';
import { voyageForecastOf } from '../../src/game/view/voyageForecast';
import { cardLooksOf } from '../../src/game/view/cardLooks';
import { voyageDaysText } from '../../src/game/looks/timeTexts';
import { parseLocale } from '../../src/locale/Localization';
import { borrowedFace } from '../../src/game/ui/cardFace';
import { readSeaChart, shortestRouteToMainland } from '../support/seaChain';

/** 海区の網（航路の宣言から組み立てたもの）。真値を測る経路をここから決める。 */
const SEA_CHART = readSeaChart();

/**
 * 積み下ろしの間に出す推定日数（docs/concept/GameEndings.md 9.3節・docs/ui/CardView.md 16節）を、
 * 同梱のYAMLから画面の文字まで通しで見る試験。
 *
 * **出航のしたくシナリオ（砂浜に積荷入りの筏）から実際に動かす。** 見積もりは海図の幅・海区の素の
 * 横断時間・積載の段の3つが噛み合って初めて出るので、**画面側だけを見ても宣言側だけを見ても
 * 噛み合っているかは分からない**。段の境目も、段が引く分数も、宣言した数字そのもの。
 */
describe('推定日数', () => {
  let codex: WorldCodex;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
  });

  /** 出航のしたくシナリオの状態（砂浜に積荷入りの筏があり、プレイヤーは岸に立っている）。 */
  function ready(): { game: StartedGame; raft: WorldObject } {
    const scenario = bundledScenario('voyage_ready');
    if (scenario === undefined) throw new Error('同梱シナリオ voyage_ready がありません。');

    const game = startNewGame(codex, SAMPLE_CHARACTER, scenario.seed, seededRng(scenario.seed));
    applyScenario(game, scenario, codex);

    const raft = game.startLocation.fixtures.find((fixture) => fixture.def.name === 'raft');
    if (raft === undefined) throw new Error('シナリオが筏を置いていません。');
    return { game, raft };
  }

  function forecastIn(
    game: StartedGame,
  ): (object: WorldObject) => ReturnType<ReturnType<typeof voyageForecastOf>> {
    return voyageForecastOf(codex, game.world);
  }

  /** 筏の積荷の枠へ物を1つ積む。 */
  function load(game: StartedGame, raft: WorldObject, objectName: string): WorldObject {
    const item = game.session.createObject(codex.objectNames.getId(objectName));
    const rejection = item.moveToSlotOrRejection(raft.getSlot(codex.slotNames.getId('items')));
    if (rejection !== undefined) throw new Error(`${objectName}を積めませんでした: ${rejection}`);
    return item;
  }

  /** 世界に在る海区（渡るのにかかる時間を持つ場所、Voyage.md 3.2節）すべて。 */
  function seaZones(game: StartedGame): readonly WorldObject[] {
    const crossingId = codex.propertyNames.getId('crossing_minutes');
    return [...game.world.instance.descendants()].filter(
      (object) => object.tryGetProperty(crossingId) !== undefined,
    );
  }

  function zoneOf(game: StartedGame, name: string): WorldObject {
    const zone = game.world.instance.findSelfOrDescendantOfDef(codex.objectNames.getId(name));
    if (zone === undefined) throw new Error(`海区 ${name} がありません。`);
    return zone;
  }

  /** 筏をその海岸へ繋ぎ直す。 */
  function mooredAt(game: StartedGame, raft: WorldObject, coastName: string): void {
    const coast = game.session.createObject(codex.objectNames.getId(coastName));
    const fixtures = coast.getSlot(codex.slotNames.getId('fixtures'));
    expect(raft.moveToSlotOrRejection(fixtures), `${coastName}へ繋げる`).toBeUndefined();
  }

  /**
   * その海区から本土まで、**最短の経路で**実際にかかる分数の合計。**筏を1海区ずつ実際に浮かべて、
   * その海区の `crossing_minutes` の実効値を読む**——見積もりと同じ式をここへ書き写すと、写した式
   * どうしが合っていることしか確かめられない。
   *
   * **経路は航路の宣言から組み立てた網を辿って決める**（`tests/support/seaChain.ts`）。分岐が入って
   * 残り海区数が経路によって変わるので、海図が言うのは最短の経路（`docs/world/Voyage.md` 3.7節）。
   */
  function minutesToMainland(game: StartedGame, raft: WorldObject, departure: WorldObject): number {
    const crossingId = codex.propertyNames.getId('crossing_minutes');
    const fixtures = codex.slotNames.getId('fixtures');

    let minutes = 0;
    for (const zoneName of shortestRouteToMainland(SEA_CHART, departure.def.name)) {
      const zone = zoneOf(game, zoneName);
      expect(raft.moveToSlotOrRejection(zone.getSlot(fixtures))).toBeUndefined();
      minutes += zone.getProperty(crossingId).getEffectiveValue();
    }
    return minutes;
  }

  /** 札と同じ刻み（半日・切り上げ）へ直す。帯の両端も同じ丸めを受けているので、比べるならこの単位。 */
  function inHalfDays(minutes: number): number {
    return Math.ceil(minutes / (24 * 60) / 0.5) * 0.5;
  }

  /** 出航先1つぶんの、札に出る帯と実際にかかる日数。 */
  interface Departure {
    readonly zone: string;
    readonly minDays: number;
    readonly maxDays: number;
    readonly trueDays: number;
  }

  /**
   * 島の海岸3つ（`coast` trait）から漕ぎ出したときの、札の帯と実際にかかる日数。
   * `sighted` は山頂から見定めた海図（幅±2、GameEndings.md 9.1節）かどうか。
   *
   * **真値は帯を読んだ後に測る**——浮かべた海区は海図に記入されてしまう（Voyage.md 3.7節）。
   */
  function departures(sighted: boolean): readonly Departure[] {
    const coasts = [
      { coast: 'sandy_beach', zone: 'coastal_waters' },
      { coast: 'rocky_coast', zone: 'tide_rip' },
      { coast: 'cliff_coast', zone: 'gull_rock' },
    ];

    return coasts.map(({ coast, zone }) => {
      const { game, raft } = ready();
      const departure = zoneOf(game, zone);
      if (sighted) departure.getProperty(codex.propertyNames.getId('chart_sighted')).setNumber(1);

      mooredAt(game, raft, coast);
      const forecast = forecastIn(game)(raft);
      if (forecast === undefined) throw new Error(`${coast}に繋いだ筏に見積もりが出ません。`);

      return {
        zone,
        minDays: forecast.minDays,
        maxDays: forecast.maxDays,
        trueDays: inHalfDays(minutesToMainland(game, raft, departure)),
      };
    });
  }

  it('どの海区も素の横断時間が同じ', () => {
    const { game } = ready();
    const crossingId = codex.propertyNames.getId('crossing_minutes');

    // **これが、1区間の時間で全区間を代表してよい根拠**（Voyage.md 3.2節）。海図が持つのは残りの
    // 海区数だけ（GameEndings.md 12.6節）なので、海区ごとに違えば下の2つの試験が同時には通らない。
    const minutes = seaZones(game).map((zone) => zone.getProperty(crossingId).number);
    expect(minutes.length, '海区は14個').toBe(14);
    expect(new Set(minutes), '素の横断時間は1種類').toEqual(new Set([minutes[0]]));
  });

  it('3つの出航先の日数の並びが、実際にかかる時間の並びと同じ向きになる', () => {
    const seen = departures(false);
    const bySpeed = [...seen].sort((a, b) => a.trueDays - b.trueDays);

    // 鎖の先頭（島影の海）が最も遠く、岸壁から出る海鳥の岩が最も近い（Voyage.md 3.6節）。
    expect(
      bySpeed.map((departure) => departure.zone),
      '実際に速いのは海鳥の岩・潮目・島影の海の順',
    ).toEqual(['gull_rock', 'tide_rip', 'coastal_waters']);

    // **どの海岸へ運ぶかを漕ぎ出す前に秤にかけられる**（GameEndings.md 5節後段）ので、札の帯は
    // 実際にかかる時間と同じ向きに並ぶ。片方の端だけでは、帯が重なったときに向きが読めない。
    for (let i = 1; i < bySpeed.length; i++) {
      const near = bySpeed[i - 1];
      const far = bySpeed[i];
      expect(far.minDays, `${far.zone}の下限は${near.zone}より短くない`).toBeGreaterThanOrEqual(near.minDays);
      expect(far.maxDays, `${far.zone}の上限は${near.zone}より短くない`).toBeGreaterThanOrEqual(near.maxDays);
    }
  });

  it('海図の幅が狭まっても、真値が帯から外れない', () => {
    for (const sighted of [false, true]) {
      for (const departure of departures(sighted)) {
        const where = `${departure.zone}（海図${sighted ? '±2' : '±5'}）`;
        expect(departure.trueDays, `${where}の真値が下限を下回らない`).toBeGreaterThanOrEqual(
          departure.minDays,
        );
        expect(departure.trueDays, `${where}の真値が上限を超えない`).toBeLessThanOrEqual(departure.maxDays);
      }
    }
  });

  it('海岸に繋いだ筏が、幅を持ったまま推定日数を出す', () => {
    const { game, raft } = ready();
    const forecast = forecastIn(game)(raft);

    expect(forecast, '砂浜の筏には見積もりが出る').toBeDefined();
    // 砂浜が面するのは島影の海（本土まで14海区）。海図はまだ方角しか知らないので±5海区の幅がある
    // （Voyage.md 3.7節）ため、日数も幅のまま出る。
    expect(forecast!.minDays).toBeGreaterThan(0);
    expect(forecast!.maxDays, '海図に幅がある間は日数も幅を持つ').toBeGreaterThan(forecast!.minDays);
  });

  it('積荷を1つ増やすと日数が延び、下ろすと戻る', () => {
    const { game, raft } = ready();
    const forecast = forecastIn(game);

    const before = forecast(raft);
    expect(before).toBeDefined();

    // 積載が速さの段を1つ下げるまで丸太を積む（1本20kg。段の境目はVoyage.md 3.2節）。
    const logs: WorldObject[] = [];
    while (forecast(raft)!.maxDays === before!.maxDays) {
      if (logs.length >= 20) throw new Error('積んでも日数が動きませんでした。');
      logs.push(load(game, raft, 'log'));
    }

    const laden = forecast(raft)!;
    expect(laden.maxDays, '積むほど横断が長くなる').toBeGreaterThan(before!.maxDays);

    // **最後の1本を下ろすだけで戻る。** 積み下ろしのたびに数字が動くことが9.3節の要（かなめ）。
    const last = logs.pop()!;
    last.destroy();
    expect(forecast(raft)!.maxDays, '1つ下ろせば戻る').toBe(before!.maxDays);

    // その1本を積み直せば、また延びる。
    load(game, raft, 'log');
    expect(forecast(raft)!.maxDays, '1つ積めばまた延びる').toBe(laden.maxDays);
  });

  it('海にも海岸にも居ない筏には出さない', () => {
    const { game, raft } = ready();
    const forecast = forecastIn(game);
    expect(forecast(raft)).toBeDefined();

    // プレイヤーの手へ移すと、面している海区が無くなる（どこへ漕ぎ出すのかが決まらない）。
    raft.moveToSlotOrRejection(game.startLocation.instance.getSlot(codex.slotNames.getId('fixtures')));
    const inland = game.session.createObject(codex.objectNames.getId('jungle'));
    expect(raft.moveToSlotOrRejection(inland.getSlot(codex.slotNames.getId('fixtures')))).toBeUndefined();
    expect(forecast(raft), '海に面していない土地では見積もりが出ない').toBeUndefined();
  });

  it('帆を組み込むと日数が縮む', () => {
    const { game, raft } = ready();
    const forecast = forecastIn(game);
    const before = forecast(raft)!;

    // 帆は積荷ではなく筏の一部（構造スロット）。**陸ではゲートが閉じている**が、海に出れば必ず
    // 効くものなので見積もりには入る（Voyage.md 3.2節）。
    const sail = game.session.createObject(codex.objectNames.getId('rawhide_sail'));
    expect(sail.moveToSlotOrRejection(raft.getSlot(codex.slotNames.getId('structure')))).toBeUndefined();

    // **帯の刻みは半日**（DAY_STEP）なので、1区間あたり30分の縮みは帯の端によっては丸めに隠れる。
    // 縮んだことが出るのは下限の側で、上限は少なくとも延びない。
    const rigged = forecast(raft)!;
    expect(rigged.minDays, '帆を張れば早く着く').toBeLessThan(before.minDays);
    expect(rigged.maxDays, '上限が延びることはない').toBeLessThanOrEqual(before.maxDays);
  });

  it('海の上でも、今いる海区の値で出す', () => {
    const { game, raft } = ready();
    const forecast = forecastIn(game);
    const moored = forecast(raft)!;

    const zone = game.world.instance.findSelfOrDescendantOfDef(codex.objectNames.getId('coastal_waters'));
    expect(zone, '海区は世界の初めから在る').toBeDefined();
    expect(raft.moveToSlotOrRejection(zone!.getSlot(codex.slotNames.getId('fixtures')))).toBeUndefined();

    // 砂浜が面しているのがこの海区なので、繋いであったときと同じ値になる（Voyage.md 3.6節）。
    expect(forecast(raft), '出航しても見積もりは続く').toEqual(moored);

    // 渡り終えた海区は海図に幅を持たない（同3.7節）ので、日数も1つの数になる。
    zone!.getProperty(codex.propertyNames.getId('chart_crossed')).setNumber(1);
    const crossed = forecast(raft)!;
    expect(crossed.minDays, '幅が消えれば両端が揃う').toBe(crossed.maxDays);
  });

  it('分かれ道に浮かんだ筏には、最短の経路での日数が出る', () => {
    // **分岐が入ると残り海区数が経路によって変わる**（GameEndings.md 12.6節）。海図が1つの数で言える
    // のは最短だけで、遠回りを選べば実際は延びる——それは海図の粗さではなく針路の選択
    // （Voyage.md 3.7節）なので、幅ではなく最短を出す。
    const { game, raft } = ready();
    const fork = zoneOf(game, 'long_swell');
    expect(raft.moveToSlotOrRejection(fork.getSlot(codex.slotNames.getId('fixtures')))).toBeUndefined();
    // 渡り終えた海区は幅を持たない（Voyage.md 3.7節）ので、帯が1つの数になり真値とそのまま比べられる。
    fork.getProperty(codex.propertyNames.getId('chart_crossed')).setNumber(1);

    const forecast = forecastIn(game)(raft)!;
    expect(forecast.minDays, '渡り終えた海区なので幅が無い').toBe(forecast.maxDays);
    expect(forecast.maxDays, '最短の経路で実際にかかる日数と合う').toBe(
      inHalfDays(minutesToMainland(game, raft, fork)),
    );
  });

  it('渡る当人でない物には出さない', () => {
    const { game, raft } = ready();
    const forecast = forecastIn(game);
    expect(forecast(load(game, raft, 'log')), '積荷そのものは渡る当人ではない').toBeUndefined();
  });

  it('筏の札の桟に、その文字が乗る', () => {
    const { game, raft } = ready();
    const looks = cardLooksOf(codex, parseLocale('ja.yaml', ''), game.world, () => undefined);
    const forecast = forecastIn(game)(raft)!;

    const days = voyageDaysText(forecast.minDays, forecast.maxDays);
    expect(looks.contentOf(raft).railText).toBe(days);
    // 子ウィンドウが借りる札（Windows.md 1.1節）も同じ見た目を出す——見た目のぶんだけを取り出す
    // 経路（cardFace）が落とすと、筏を開いた先だけ日数が消える。
    expect(borrowedFace(looks.contentOf(raft)).railText).toBe(days);
    // 見積もりを持たない物の札は、桟に文字を出さない。
    expect(looks.contentOf(load(game, raft, 'log')).railText).toBeUndefined();
  });

  it('幅が無くなれば1つの数として書く', () => {
    expect(voyageDaysText(2.5, 2.5)).toBe('本土まで 2.5日');
    expect(voyageDaysText(1.5, 3)).toBe('本土まで 1.5〜3日');
  });
});
