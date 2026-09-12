import { describe, expect, it } from 'vitest';
import type { DailyLabour } from '../../src/analysis/balanceTables';
import type { VoyageCourse, VoyageLegs } from '../../src/analysis/voyageLegs';
import { voyageLegsOf } from '../../src/analysis/voyageLegs';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * 航海の区間の測り方（`src/analysis/voyageLegs.ts`）の検証。**引いた線がそのまま検証項目**で、
 * 折り返しの航路を辺に数えないこと・卓の候補を「何も返らない／拾える／海区へ立つ」に割ること・
 * 分かれ道から本土までの針路を全部並べること・風の受け方を条件から読むことを確かめる。
 *
 * 世界は合成する。**本物の `voyage.yaml` で確かめると、値が合っていることしか言えない**——線を
 * 踏み外したときに落ちることは、線の両側を持つ世界でしか見えない（折り返しの航路が混ざる、
 * 重み0の候補が並ぶ、遠回りが2区間になる、といった形）。
 */
describe('航海の区間の測り方（voyageLegs）', () => {
  const YAML = `
traits:
  sea_zone:
    tags: [sea]
    props:
      crossing_minutes: {value: 300, range: {min: 60, max: 900}}
      zones_to_mainland: {range: {min: 1, max: 30}}
      storm_drift: {value: 0, range: {min: 0, max: 16}}
      barren_find: {value: 0}
      drift_find: {value: 0}
      wreck_find: {value: 0}
      shoal_find: {value: 0}
    interactions:
      explore:
        trigger: menu
        duration: 30
        add: {self: {exploration_progress: 1}}
        pick:
          - weight: {prop: barren_find}
          - weight: {prop: drift_find}
            spawn: {object: driftwood, count: 2, into: agent}
          - weight: {prop: wreck_find}
            spawn: {object: relic, into: agent}
          - weight: {prop: shoal_find}
            spawn: {object: shoal, into: self}

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
          - {subject: ancestor, prop: wind, eq: crosswind}
        modify: {self: {crossing_minutes: -10}}
      - conditions:
          - {prop: destination_zones_to_mainland, lt: {subject: parent, prop: zones_to_mainland}}
          - {subject: ancestor, prop: wind, eq: tailwind}
        modify: {self: {crossing_minutes: -40}}
      - conditions:
          - {prop: destination_zones_to_mainland, lt: {subject: parent, prop: zones_to_mainland}}
          - {subject: ancestor, prop: wind, eq: headwind}
        modify: {self: {crossing_minutes: 20}}
      - conditions:
          - {prop: destination_zones_to_mainland, gt: {subject: parent, prop: zones_to_mainland}}
          - {subject: ancestor, prop: wind, eq: tailwind}
        modify: {self: {crossing_minutes: 15}}
      - conditions:
          - {prop: destination_zones_to_mainland, gt: {subject: parent, prop: zones_to_mainland}}
          - {subject: ancestor, prop: wind, eq: headwind}
        modify: {self: {crossing_minutes: -35}}

  coast:
    tags: [coast]
    props:
      offshore_home_waters: {value: 0}
      offshore_outer_waters: {value: 0}

object_defs:
  world:
    props:
      wind: {value: crosswind}
      tailwind_weight: {value: 0}
      crosswind_weight: {value: 0}
      headwind_weight: {value: 0}
      wind_remaining:
        value: 32
        range: {min: 0, max: 999}
        on_min:
          pick:
            - weight: {prop: tailwind_weight}
              set: {self: {wind: tailwind, wind_remaining: 32}}
            - weight: {prop: crosswind_weight}
              set: {self: {wind: crosswind, wind_remaining: 32}}
            - weight: {prop: headwind_weight}
              set: {self: {wind: headwind, wind_remaining: 32}}
      season:
        value: calm
        stages:
          - name: calm
            passives:
              - modify: {self: {tailwind_weight: 50, crosswind_weight: 25, headwind_weight: 25}}
          - name: wet
            passives:
              - modify: {self: {tailwind_weight: 0, crosswind_weight: 0, headwind_weight: 100}}

  driftwood:
    tags: [item]
  relic:
    tags: [item]
  shoal:
    tags: [fixture]
    bound_to_owner: true

  sandy_beach:
    traits: [coast]
    props:
      offshore_home_waters: {value: 1}
  rocky_coast:
    traits: [coast]
    props:
      offshore_outer_waters: {value: 1}

  raft:
    props:
      weight: {value: 0}
    interactions:
      set_sail:
        trigger: menu
        duration: 60
        pick:
          - weight: {subject: parent, prop: offshore_home_waters}
            move: {subject: self, to_object: home_waters}
          - weight: {subject: parent, prop: offshore_outer_waters}
            move: {subject: self, to_object: outer_waters}

  home_waters:
    singleton: true
    traits: [sea_zone]
    props:
      zones_to_mainland: {value: 3}
      barren_find: {value: 40}
      drift_find: {value: 40}
      shoal_find: {value: 20}
      exploration_progress:
        value: 0
        range: {min: 0, max: 2}
        on_max:
          spawn:
            - {object: route_to_far_waters, into: self}
            - {object: route_to_home_waters, into_object: far_waters}
            - {object: route_to_outer_waters, into: self}
            - {object: route_to_home_waters, into_object: outer_waters}

  outer_waters:
    singleton: true
    traits: [sea_zone]
    props:
      zones_to_mainland: {value: 4}
      barren_find: {value: 100}
      storm_drift: {value: 0, range: {min: 0, max: 8}}
      exploration_progress:
        value: 0
        range: {min: 0, max: 4}
        on_max:
          spawn:
            - {object: route_to_far_waters, into: self}
            - {object: route_to_outer_waters, into_object: far_waters}

  far_waters:
    singleton: true
    traits: [sea_zone]
    props:
      zones_to_mainland: {value: 2}
      crossing_minutes: {value: 240}
      barren_find: {value: 100}
      exploration_progress:
        value: 0
        range: {min: 0, max: 3}
        on_max:
          spawn:
            - {object: route_to_mainland, into: self}

  route_to_home_waters:
    traits: [sea_route]
    props:
      destination_zone: {value: {object: home_waters}}
      destination_zones_to_mainland: {value: 3}
  route_to_outer_waters:
    traits: [sea_route]
    props:
      destination_zone: {value: {object: outer_waters}}
      destination_zones_to_mainland: {value: 4}
  route_to_far_waters:
    traits: [sea_route]
    props:
      destination_zone: {value: {object: far_waters}}
      destination_zones_to_mainland: {value: 2}
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

  /** 日数の分母。**丸い数にする**——測っている値ではないので、桁の一致で読み手を迷わせない。 */
  const LABOUR: DailyLabour = { minimumLabourMinutes: 640, surplusMinutes: 800 };

  const legs: VoyageLegs = voyageLegsOf(
    new WorldCodexYamlLoader().load('voyage-test.yaml', YAML).buildAndReset(),
    LABOUR,
  );

  function zone(name: string) {
    const found = legs.zones.find((candidate) => candidate.name === name);
    if (found === undefined) throw new Error(`海区 ${name} が測られていない`);
    return found;
  }

  function course(coastName: string, detour: boolean): VoyageCourse {
    const found = legs.courses.find((c) => c.coastName === coastName && c.detour === detour);
    if (found === undefined) throw new Error(`${coastName} の針路が測られていない`);
    return found;
  }

  it('海区は、見張りの回数・素の横断時間・押し流しまでを宣言から読む', () => {
    expect(legs.zones.map((z) => z.name)).toEqual(['home_waters', 'outer_waters', 'far_waters']);
    expect(zone('home_waters').lookouts).toBe(2);
    expect(zone('home_waters').lookoutMinutes).toBe(60);

    // 素の横断時間は海区ごと（far_waters だけ trait の値を上書きしている）。
    expect(zone('home_waters').crossingMinutes).toBe(300);
    expect(zone('far_waters').crossingMinutes).toBe(240);

    // 押し流しまでの長さも海区ごと（outer_waters だけ短い）。
    expect(zone('home_waters').stormDriftTicks).toBe(16);
    expect(zone('outer_waters').stormDriftTicks).toBe(8);
  });

  it('折り返しの航路は辺に数えない', () => {
    // home_waters は自分へ戻る航路も湧かせるが、辺として出るのは先へ進む2本だけ。
    expect(zone('home_waters').legs.map((leg) => leg.destinationName)).toEqual([
      'far_waters',
      'outer_waters',
    ]);
    expect(zone('far_waters').legs.map((leg) => leg.destinationName)).toEqual(['mainland']);
  });

  it('辺の向きは、行き先と今いる海区の残り海区数の差で決まる', () => {
    expect(zone('home_waters').legs.map((leg) => leg.direction)).toEqual([
      'toward_mainland',
      'toward_offshore',
    ]);
  });

  it('卓は「何も返らない／拾える／海区へ立つ」に割れ、重み0の候補は落ちる', () => {
    const home = zone('home_waters');
    expect(home.barrenShare).toBe(0.4);
    expect(home.foragedShare).toBeCloseTo(0.4, 10);
    expect(home.spawnedShare).toBe(0.2);
    expect(home.finds).toEqual([
      { objectName: 'driftwood', expectedPerLookout: 0.8, spawnsIntoZone: false },
      { objectName: 'shoal', expectedPerLookout: 0.2, spawnsIntoZone: true },
    ]);

    // 見張り2回で、湧くものが1度以上立つ割合。
    expect(home.spawnedBySighting).toBeCloseTo(0.36, 10);
  });

  it('風の受け方は、辺の向きと風向きの条件から読む', () => {
    expect(legs.windLegs).toEqual([
      { wind: 'tailwind', direction: 'toward_mainland', minutes: -40 },
      { wind: 'tailwind', direction: 'toward_offshore', minutes: 15 },
      // 横風は向きを見ないので、どちらの辺にも同じだけ乗る。
      { wind: 'crosswind', direction: 'toward_mainland', minutes: -10 },
      { wind: 'crosswind', direction: 'toward_offshore', minutes: -10 },
      { wind: 'headwind', direction: 'toward_mainland', minutes: 20 },
      { wind: 'headwind', direction: 'toward_offshore', minutes: -35 },
    ]);
  });

  it('出航地点ごとに、本土まで渡り切る針路を短い順に並べる', () => {
    expect(legs.courses.map((c) => [c.coastName, c.detour, c.legs])).toEqual([
      ['sandy_beach', false, 2],
      ['sandy_beach', true, 3],
      ['rocky_coast', false, 2],
    ]);
    expect(course('sandy_beach', false).zoneNames).toEqual(['home_waters', 'far_waters']);
    expect(course('sandy_beach', true).zoneNames).toEqual(['home_waters', 'outer_waters', 'far_waters']);
  });

  it('針路の合計は見張りと素の横断の和で、日数は渡された自由時間で割る', () => {
    const shortest = course('sandy_beach', false);
    expect(shortest.lookouts).toBe(5);
    expect(shortest.lookoutMinutes).toBe(150);
    expect(shortest.crossingMinutes).toBe(540);
    expect(shortest.total).toEqual({ totalMinutes: 690, days: 690 / LABOUR.surplusMinutes });
  });

  it('同じ風が通しで吹いた場合の合計は、辺ごとに向きで受け方を変える', () => {
    // 近道は2本とも本土の側の辺なので、追い風はどちらも40分縮める。
    expect(course('sandy_beach', false).byWind.get('tailwind')?.totalMinutes).toBe(610);

    // 遠回りの1本目だけが沖の側の辺で、追い風では15分伸びる。
    expect(course('sandy_beach', true).byWind.get('tailwind')?.totalMinutes).toBe(1045);
  });

  it('季節ごとの合計は、その季節が配る風の重みの割合で期待する', () => {
    const shortest = course('sandy_beach', false);

    // 雨季は向かい風しか引かないので、通しの向かい風とまったく同じになる。
    expect(shortest.bySeason.get('wet')).toEqual(shortest.byWind.get('headwind'));

    // 穏やかは追い風50・横風25・向かい風25。本土の側の辺1本あたり -17.5 分。
    expect(shortest.bySeason.get('calm')?.totalMinutes).toBe(655);
  });
});
