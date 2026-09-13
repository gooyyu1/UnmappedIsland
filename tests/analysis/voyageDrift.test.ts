import { describe, expect, it } from 'vitest';
import type { DailyLabour } from '../../src/analysis/balanceTables';
import type { VoyageDriftRun } from '../../src/analysis/voyageDrift';
import { VoyageDriftSimulation } from '../../src/analysis/voyageDrift';
import type { VoyageCourse } from '../../src/analysis/voyageLegs';
import { voyageLegsOf } from '../../src/analysis/voyageLegs';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * 押し流しを入れて渡らせる側（`src/analysis/voyageDrift.ts`）の検証。
 *
 * **世界は合成する。** 同梱の `voyage.yaml` で回すと、荒天に当たるかどうかが天気の引き当て次第になり、
 * **どの主張も「今のところそうなっている」までしか言えない。** ここで確かめたいのは天気の当たり外れ
 * ではなく、**渡り切るまでの勘定が合っていること**なので、荒天を据えた世界と据えない世界の両方を作って
 * 突き合わせる。
 *
 * 鎖は `island_waters`（3）—`mid_waters`（2）—`near_waters`（1）—本土の一本道で、**辺で繋がった隣は
 * 本土までの残り海区数がちょうど1つ違う**（同梱の網と同じ形）。端は片側の隣を持たないので、その風下を
 * 引いた回は何も起きない。
 */
describe('押し流しを入れた航海（voyageDrift）', () => {
  /**
   * 合成した世界。`weather` と `season` だけを外から据える——**季節が風向きの重みを配る**ので、
   * どちらへ流されるかもここで決まる。
   */
  function yamlOf(weather: string, season: string): string {
    return `
traits:
  sea_zone:
    tags: [sea, location]
    slots:
      fixtures: {cell: {accept: {tag: fixture}}}
    props:
      crossing_minutes: {value: 300, range: {min: 60, max: 900}}
      zones_to_mainland: {range: {min: 1, max: 30}}
      barren_find: {value: 100}
      drift_to_mainland_weight: {value: 0}
      drift_to_island_weight: {value: 0}
      storm_drift:
        value: 0
        range: {min: 0, max: 32}
        on_max:
          set: {self: {storm_drift: 0}}
          pick:
            - weight: {prop: drift_to_mainland_weight}
              among: {slot: fixtures, matches: {object: raft}}
              move: {subject: picked, to_object: {prop: zone_toward_mainland}}
            - weight: {prop: drift_to_island_weight}
              among: {slot: fixtures, matches: {object: raft}}
              move: {subject: picked, to_object: {prop: zone_toward_island}}
    passives:
      - conditions:
          - {subject: ancestor, prop: wind, eq: tailwind}
        modify: {self: {drift_to_mainland_weight: 1}}
      - conditions:
          - {subject: ancestor, prop: wind, eq: headwind}
        modify: {self: {drift_to_island_weight: 1}}
      - conditions:
          - {slot: fixtures, matches: {object: raft}}
          - {subject: ancestor, prop: weather, eq: storm}
          - not: {subject: ancestor, prop: wind, eq: crosswind}
        add: {self: {storm_drift: 1}}
      - conditions:
          - not:
              all:
                - {slot: fixtures, matches: {object: raft}}
                - {subject: ancestor, prop: weather, eq: storm}
        add: {self: {storm_drift: -1}}
    interactions:
      explore:
        trigger: menu
        duration: 30
        add: {self: {exploration_progress: 1}}
        pick:
          - weight: {prop: barren_find}

  sea_route:
    tags: [fixture]
    props:
      weight: {value: 0}
      destination_zone: {}
      destination_zones_to_mainland: {}
      crossing_minutes:
        value: 0
        base: {subject: parent, prop: crossing_minutes}
        range: {min: 60, max: 900}
    passives:
      - conditions:
          - {prop: destination_zones_to_mainland, lt: {subject: parent, prop: zones_to_mainland}}
          - {subject: ancestor, prop: wind, eq: headwind}
        modify: {self: {crossing_minutes: 60}}

  coast:
    tags: [coast]
    props:
      offshore_island_waters: {value: 0}

object_defs:
  world:
    slots:
      locations: {cell: {accept: {tag: location}}}
    props:
      weather: {value: ${weather}}
      wind: {value: crosswind}
      tailwind_weight: {value: 0}
      crosswind_weight: {value: 0}
      headwind_weight: {value: 0}
      wind_remaining:
        value: 32
        range: {min: 0, max: 999}
        passives:
          - add: {self: {wind_remaining: -1}}
        on_min:
          pick:
            - weight: {prop: tailwind_weight}
              set: {self: {wind: tailwind, wind_remaining: 32}}
            - weight: {prop: crosswind_weight}
              set: {self: {wind: crosswind, wind_remaining: 32}}
            - weight: {prop: headwind_weight}
              set: {self: {wind: headwind, wind_remaining: 32}}
      season:
        value: ${season}
        stages:
          - name: calm
            passives:
              - modify: {self: {tailwind_weight: 0, crosswind_weight: 100, headwind_weight: 0}}
          - name: wet
            passives:
              - modify: {self: {tailwind_weight: 50, crosswind_weight: 0, headwind_weight: 50}}

  sandy_beach:
    traits: [coast]
    props:
      offshore_island_waters: {value: 1}

  raft:
    tags: [fixture]
    props:
      weight: {value: 0}
    interactions:
      set_sail:
        trigger: menu
        duration: 60
        pick:
          - weight: {subject: parent, prop: offshore_island_waters}
            move: {subject: self, to_object: island_waters}

  island_waters:
    singleton: true
    traits: [sea_zone]
    props:
      zones_to_mainland: {value: 3}
      zone_toward_mainland: {value: {object: mid_waters}}
      exploration_progress:
        value: 0
        range: {min: 0, max: 2}
        on_max:
          spawn:
            - {object: route_to_mid_waters, into: self}
            - {object: route_to_island_waters, into_object: {prop: zone_toward_mainland}}

  mid_waters:
    singleton: true
    traits: [sea_zone]
    props:
      zones_to_mainland: {value: 2}
      zone_toward_mainland: {value: {object: near_waters}}
      zone_toward_island: {value: {object: island_waters}}
      exploration_progress:
        value: 0
        range: {min: 0, max: 2}
        on_max:
          spawn:
            - {object: route_to_near_waters, into: self}
            - {object: route_to_mid_waters, into_object: {prop: zone_toward_mainland}}

  near_waters:
    singleton: true
    traits: [sea_zone]
    props:
      zones_to_mainland: {value: 1}
      zone_toward_island: {value: {object: mid_waters}}
      exploration_progress:
        value: 0
        range: {min: 0, max: 2}
        on_max:
          spawn:
            - {object: route_to_mainland, into: self}

  route_to_island_waters:
    traits: [sea_route]
    props:
      destination_zone: {value: {object: island_waters}}
      destination_zones_to_mainland: {value: 3}
  route_to_mid_waters:
    traits: [sea_route]
    props:
      destination_zone: {value: {object: mid_waters}}
      destination_zones_to_mainland: {value: 2}
  route_to_near_waters:
    traits: [sea_route]
    props:
      destination_zone: {value: {object: near_waters}}
      destination_zones_to_mainland: {value: 1}
  route_to_mainland:
    traits: [sea_route]
    props:
      destination_zone: {value: {object: mainland}}
      destination_zones_to_mainland: {value: 0}

  mainland:
    singleton: true
    props:
      weight: {value: 0}
`;
  }

  /** 日数の分母。**丸い数にする**——測っている値ではないので、桁の一致で読み手を迷わせない。 */
  const LABOUR: DailyLabour = { minimumLabourMinutes: 640, surplusMinutes: 800 };

  /** その世界で続けて渡らせる。 */
  function sailIn(
    weather: string,
    season: string,
    voyages: number,
  ): { course: VoyageCourse; runs: readonly VoyageDriftRun[] } {
    const codex = new WorldCodexYamlLoader()
      .load('voyage-drift-test.yaml', yamlOf(weather, season))
      .buildAndReset();
    const legs = voyageLegsOf(codex, LABOUR);

    const course = legs.courses.find((candidate) => !candidate.detour);
    if (course === undefined) throw new Error('区間の最も少ない針路がありません。');

    const simulation = new VoyageDriftSimulation(codex, legs, 1);
    return {
      course,
      runs: Array.from({ length: voyages }, () => simulation.sail(course.coastName, course.startZoneName)),
    };
  }

  const sweptOf = (run: VoyageDriftRun): number => run.sweptBackwards + run.sweptForwards;

  it('荒天の無い海では、静的に解いた側と同じ区間数・同じ日数で終わる', () => {
    // **横風しか吹かない季節（calm）に置く。** 風向きが変われば1区間の時間も変わるので、風の混ざる
    // 季節では静的な期待値としか比べられず、**見張り1回を何分と数えているか**のような食い違いが
    // 平均の中に紛れる。
    const { course, runs } = sailIn('clear', 'calm', 5);

    const expected = course.bySeason.get('calm');
    if (expected === undefined) throw new Error('穏やかな季節の合計がありません。');

    for (const run of runs) {
      expect(sweptOf(run), '押し流された回数').toBe(0);
      expect(run.crossings, '漕ぎ出した回数').toBe(course.legs);
      expect(run.voidedCrossings, '空振りになった渡り').toBe(0);
      expect(run.workMinutes, '見張りと横断へ充てた分').toBe(expected.totalMinutes);
      // 日数の分母は島側の労働と同じ（`VoyageStats.md`「日数の分母」）。ここがずれると、押し流しを
      // 入れた日数と入れない日数が別の物差しで並ぶ。
      expect(run.days, '実日数').toBeCloseTo(expected.days, 1);
    }
  });

  it('荒天の続く海では押し流され、流された向きと空振りのぶんだけ漕ぎ出す回数が増える', () => {
    const { course, runs } = sailIn('storm', 'wet', 20);

    expect(
      runs.filter((run) => sweptOf(run) > 0).length,
      '荒天を据えたのに1度も押し流されない',
    ).toBeGreaterThan(0);
    expect(
      runs.filter((run) => run.voidedCrossings > 0).length,
      '渡っている最中に流された回が1度も無い',
    ).toBeGreaterThan(0);

    for (const run of runs)
      // 辺で繋がった隣は本土までの残り海区数がちょうど1つ違うので、渡り切るまでの回数は
      // 「素の区間数＋押し戻された回−押し進められた回＋空振り」で決まる。
      expect(run.crossings, '漕ぎ出した回数').toBe(
        course.legs + run.sweptBackwards - run.sweptForwards + run.voidedCrossings,
      );
  });

  it('横風の間は押し流されない', () => {
    // 荒天でも、風下に当たる隣がいない（`Voyage.md` 3.8節）。据えるのは天気だけで、横風しか吹かない
    // 季節に置く。
    const { course, runs } = sailIn('storm', 'calm', 5);

    for (const run of runs) {
      expect(sweptOf(run), '押し流された回数').toBe(0);
      expect(run.crossings, '漕ぎ出した回数').toBe(course.legs);
    }
  });

  it('出航したときの季節を名乗る', () => {
    expect(sailIn('clear', 'wet', 2).runs.map((run) => run.seasonName)).toEqual(['wet', 'wet']);
  });
});
