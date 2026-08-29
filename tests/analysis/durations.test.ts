import { describe, expect, it } from 'vitest';
import { durationsOf, toolWearsOf } from '../../src/analysis/durations';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * 日をまたぐ長さの抽出（`src/analysis/durations.ts`）の検証。**引いた線がそのまま検証項目**で、
 * 1日未満が落ちること・隣の物に押されて進むものが入らないこと・使うたびに減る値が回数で出ること、
 * そして種類の違う長さが1本の列に混ざって並ぶことを確かめる。
 */
describe('日をまたぐ長さの抽出（durations）', () => {
  const YAML = `
traits:
  # 生のまま腐る速さ。**塩蔵されていない間だけ**効く（型を見れば真偽が決まる条件）。
  # 濡れている間の上乗せのほうは、実行時にしか決まらない。
  rots_raw:
    props:
      wet: {value: 0}
      durability:
        value: 960
        range: {min: 0, max: 960}
        on_min: {destroy: self}
    passives:
      - conditions:
          - not: {subject: self, matches: {tag: cured}}
        add: {self: {durability: -4}}
      - conditions:
          - {prop: wet, gte: 1}
        add: {self: {durability: -1}}

  # 塩蔵された物。腐る速さを1つだけ持ち、条件を持たない。
  salted:
    tags: [cured]
    passives:
      - add: {self: {durability: -0.5}}

  # 「塩蔵かつ乾燥」の両方が揃ったときだけ効かない腐敗。片方しか名乗らない型では成立する。
  rots_unless_both:
    props:
      durability:
        value: 960
        range: {min: 0, max: 960}
        on_min: {destroy: self}
    passives:
      - conditions:
          - not:
              all:
                - {subject: self, matches: {tag: cured}}
                - {subject: self, matches: {tag: dried}}
        add: {self: {durability: -1}}

object_defs:
  # 10日で治る傷。端で自分が消える。
  bruise:
    tags: [injury]
    props:
      severity:
        value: 960
        range: {min: 0, max: 960}
        passives:
          - add: {self: {severity: -1}}
        on_min: {destroy: self}

  # 折れ方を生成時に1回ロールする傷（6.2節）。軽く出れば5日、重く出れば10日残る。
  sprain:
    tags: [injury]
    props:
      severity:
        value: {min: 480, max: 960}
        range: {min: 0, max: 960}
        passives:
          - add: {self: {severity: -1}}
        on_min: {destroy: self}

  # 上端へ育つ値をロールする物。高く出るほど早く届くので、長いのは下端に出た場合。
  seedling:
    tags: [item]
    props:
      growth:
        value: {min: 0, max: 480}
        range: {min: 0, max: 960}
        passives:
          - add: {self: {growth: 1}}
        on_max: {destroy: self}

  # 2.5日で腐る食べ物。濡れている間だけ倍の速さで傷む（条件つきの増減）。
  berry:
    tags: [item]
    props:
      wet: {value: 1}
      durability:
        value: 240
        range: {min: 0, max: 240}
        passives:
          - add: {self: {durability: -1}}
          - conditions: [{prop: wet, gte: 1}]
            add: {self: {durability: -1}}
        on_min: {destroy: self}

  # 1日に満たない長さ。1日の中で何度も回るものとして落ちる。
  torch:
    tags: [item]
    props:
      life:
        value: 32
        range: {min: 0, max: 32}
        passives:
          - add: {self: {life: -1}}
        on_min: {destroy: self}

  # 押されて初めて進む値。炉に入れられている間だけ焼ける。
  raw_meat:
    tags: [roastable]
    props:
      roast:
        value: 0
        range: {min: 0, max: 4800}
        on_max: {destroy: self}

  hearth:
    tags: [fixture]
    slots:
      fire:
        cell_count: 1
        cell: {accept: {tag: roastable}}
    passives:
      - add: {child: {roast: 1}}

  # 使ったときだけ削れる道具と、それを要求する工程。
  stone_axe:
    tags: [item, chopping_tool]
    props:
      durability:
        value: 960
        range: {min: 0, max: 960}

  tree:
    tags: [fixture]
    interactions:
      fell:
        trigger: {drag: {tag: chopping_tool}}
        duration: 240
        add: {instrument: {durability: -120}}

  fish:
    tags: [item]
    traits: [rots_raw]

  salted_fish:
    tags: [item]
    traits: [rots_raw, salted]

  # 塩蔵は名乗るが乾燥は名乗らない。「両方ではない」は成立するので、腐敗は効く。
  salted_plum:
    tags: [item, cured]
    traits: [rots_unless_both]
`;

  const codex = new WorldCodexYamlLoader().load('durations.yaml', YAML).buildAndReset();

  it('種類の違う長さが、日へ揃って長い順に1本の列で並ぶ', () => {
    expect(durationsOf(codex).map((duration) => [duration.objectName, duration.days])).toEqual([
      ['salted_fish', 20],
      ['bruise', 10],
      ['salted_plum', 10],
      ['seedling', 5],
      ['sprain', 5],
      ['berry', 2.5],
      ['fish', 2.5],
    ]);
  });

  it('条件つきの増減が全部重なった場合の長さも持つ', () => {
    const berry = durationsOf(codex).find((duration) => duration.objectName === 'berry');
    expect(berry).toMatchObject({ days: 2.5, shortestDays: 1.25, destroysSelf: true, repeats: false });
  });

  it('生成時のロールの幅は、条件つきの幅と別の列で出る', () => {
    const found = (name: string) => durationsOf(codex).find((duration) => duration.objectName === name);

    // ロールだけを持つ物。条件つきは1通りなので幅は出ず、長さの幅はロールだけから出る。
    expect(found('sprain')).toMatchObject({ days: 5, shortestDays: 5, longestDays: 10 });

    // 条件つきだけを持つ物。ロールの列は畳まれずにdaysと等しいままになる。
    expect(found('berry')).toMatchObject({ days: 2.5, shortestDays: 1.25, longestDays: 2.5 });
  });

  it('上端へ向かう値では、ロールが高く出たほうが短い', () => {
    // 長さは端までの距離で決まるので、ロールのどちらの端が遠いかは向かう端で裏返る。宣言の下端を
    // 一律に基準とすると、ここでは幅の上端がdaysに入り、育ちかけで生まれた株の5日が落ちる。
    const seedling = durationsOf(codex).find((duration) => duration.objectName === 'seedling');
    expect(seedling).toMatchObject({ days: 5, shortestDays: 5, longestDays: 10 });
  });

  it('1日に満たない長さは数えない', () => {
    expect(durationsOf(codex).map((duration) => duration.objectName)).not.toContain('torch');
  });

  it('隣の物に押されて初めて進む値は数えない', () => {
    expect(durationsOf(codex).map((duration) => duration.objectName)).not.toContain('raw_meat');
  });

  it('否定の下の論理積は論理和なので、片方しか当てはまらない型でも落とさない', () => {
    // 「cured かつ dried」の否定は、curedしか名乗らない型では成立する。両方を必須として読むと、
    // この型の腐敗が丸ごと消えて長さが出なくなる。
    expect(durationsOf(codex).find((duration) => duration.objectName === 'salted_plum')).toMatchObject({
      days: 10,
    });
  });

  it('使うたびに減る値は、日ではなく回数で出す', () => {
    expect(toolWearsOf(codex)).toEqual([
      {
        objectName: 'stone_axe',
        propertyName: 'durability',
        stepName: 'fell',
        stepOwnerName: 'tree',
        uses: 8,
        laborMinutes: 240,
      },
    ]);
  });

  it('型を見れば真偽が決まる条件は、成立する場合としない場合がある条件として数えない', () => {
    const found = (name: string) => durationsOf(codex).find((duration) => duration.objectName === name);

    // 生の腐敗は塩蔵されていない魚では常に効くので、最も遅い場合でもこれが効く。
    expect(found('fish')).toMatchObject({ days: 2.5, shortestDays: 2 });

    // 塩漬けの魚では一度も効かないので、最も速い場合でも足されない。
    expect(found('salted_fish')).toMatchObject({ days: 20, shortestDays: 960 / 1.5 / 96 });
  });

  it('使うたびに減る値は、日の列には現れない', () => {
    expect(durationsOf(codex).map((duration) => duration.objectName)).not.toContain('stone_axe');
  });
});
