import { beforeEach, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { YamlLoadError } from '../../src/loader/YamlLoadError';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';

/**
 * passivesの中のtransfer（GameElementDefinition.md 8.4節）。activeと同じ1つの動詞が、置き場所だけで
 * 「一度きり」から「tick毎」に変わる。
 *
 * 寄与として登録できない（2つのプロパティを同時に動かすため）ので、宣言元のtickで走る。走らせ方はactiveの
 * 輸送と同じ——宣言順に適用し、互いの結果を見る。ここで見るのはその帰結——在庫の分だけ動くこと、
 * 直列に繋いだときの緩衝は速度の差が作ること。
 */
describe('passivesのtransfer', () => {
  let nextInstanceId: number;
  let session: WorldSession;

  beforeEach(() => {
    nextInstanceId = 1;
  });

  function load(yaml: string): WorldCodex {
    return new WorldCodexYamlLoader().load('core.yaml', yaml).build();
  }

  function spawn(codex: WorldCodex, objectName: string): WorldObject {
    session = new WorldSession(codex);
    const def = codex.objects.get(codex.objectNames.getId(objectName));
    return new WorldObject(nextInstanceId++, def, session);
  }

  /** 胃→腸→蓄えの3段（消化の骨格）。段ごとの速度だけを変えて使い回す。 */
  const digestion = (stomachRate: number, digestingRate: number): string => `
object_defs:
  body:
    props:
      stomach:
        value: 10
        range: {min: 0, max: 32}
      digesting:
        value: 0
        range: {min: 0, max: 64}
      body_fat:
        value: 0
        range: {min: 0, max: 1000}
    passives:
      - transfer: {from_prop: stomach, to_prop: digesting, amount: ${stomachRate}}
      - transfer: {from_prop: digesting, to_prop: body_fat, amount: ${digestingRate}}
`;

  function valuesOf(instance: WorldObject, codex: WorldCodex): readonly number[] {
    return ['stomach', 'digesting', 'body_fat'].map(
      (name) => instance.tryGetProperty(codex.propertyNames.getId(name))?.number ?? 0,
    );
  }

  it('tick毎に、在庫の分だけ移す', () => {
    const codex = load(`
object_defs:
  body:
    props:
      stomach: {value: 2, range: {min: 0, max: 32}}
      digesting: {value: 0, range: {min: 0, max: 64}}
    passives:
      - transfer: {from_prop: stomach, to_prop: digesting, amount: 1}
`);
    const instance = spawn(codex, 'body');
    const stomachId = codex.propertyNames.getId('stomach');
    const digestingId = codex.propertyNames.getId('digesting');

    instance.tick();
    expect([
      instance.tryGetProperty(stomachId)?.number ?? 0,
      instance.tryGetProperty(digestingId)?.number ?? 0,
    ]).toEqual([1, 1]);

    instance.tick();
    expect([
      instance.tryGetProperty(stomachId)?.number ?? 0,
      instance.tryGetProperty(digestingId)?.number ?? 0,
    ]).toEqual([0, 2]);

    // 出せる量が無くなれば止まる（出す側がrange.minを割ることはない）。
    instance.tick();
    expect([
      instance.tryGetProperty(stomachId)?.number ?? 0,
      instance.tryGetProperty(digestingId)?.number ?? 0,
    ]).toEqual([0, 2]);
  });

  it('直列に繋いだ輸送は、上流を速くした差が中間に溜まる', () => {
    // 中間（腸）に在庫を作るのは engine ではなく速度の差。ここが「食べたのに身にならない」
    // （下痢）が奪える量そのものになる。
    const codex = load(digestion(2, 1));
    const instance = spawn(codex, 'body');

    instance.tick();
    expect(valuesOf(instance, codex), '入った2のうち1が抜け、1が残る').toEqual([8, 1, 1]);

    instance.tick();
    expect(valuesOf(instance, codex)).toEqual([6, 2, 2]);

    instance.tick();
    expect(valuesOf(instance, codex), '毎tick 1ずつ溜まっていく').toEqual([4, 3, 3]);
  });

  it('同じ速度で並べると中間には溜まらない（宣言順にそのまま流れる）', () => {
    // 輸送は宣言順に互いの結果を見るので、上流から届いた分は同じtickのうちに下流へ抜ける。
    // 中間に在庫を持たせたければ速度差を付ける（上のテスト）。
    const codex = load(digestion(1, 1));
    const instance = spawn(codex, 'body');

    instance.tick();

    expect(valuesOf(instance, codex)).toEqual([9, 0, 1]);
  });

  it('段ごとに速度を変えられる（多いほど速く出ていく）', () => {
    // 消化の胃はこの形（DigestionSystem.md 3節）。比例した排出を段の階段で近似し、
    // 溜まるほど速く出るので、絞りすぎて溜まり続けることがない。
    const codex = load(`
object_defs:
  body:
    props:
      stomach:
        value: 30
        range: {min: 0, max: 32}
        stages:
          - {name: light}
          - name: filled
            min: 12
            passives: [{transfer: {from_prop: stomach, to_prop: digesting, amount: 3}}]
          - name: full
            min: 24
            passives: [{transfer: {from_prop: stomach, to_prop: digesting, amount: 4}}]
      digesting: {value: 0, range: {min: 0, max: 64}}
`);
    const instance = spawn(codex, 'body');
    const stomachId = codex.propertyNames.getId('stomach');

    instance.tick();
    expect(instance.tryGetProperty(stomachId)?.number ?? 0, '満杯の段では4ずつ').toBe(26);

    instance.tick();
    instance.tick();
    expect(instance.tryGetProperty(stomachId)?.number ?? 0, '24を割ると3ずつへ落ちる').toBe(19);

    // 最下段は輸送を宣言していないので、そこまで減れば止まる。
    for (let i = 0; i < 5; i++) instance.tick();
    expect(instance.tryGetProperty(stomachId)?.number ?? 0).toBe(10);
  });

  it('同じ値から出す輸送が並んでも、在庫を二重には動かさない', () => {
    const codex = load(`
object_defs:
  body:
    props:
      stomach: {value: 1, range: {min: 0, max: 32}}
      digesting: {value: 0, range: {min: 0, max: 64}}
      body_fat: {value: 0, range: {min: 0, max: 1000}}
    passives:
      - transfer: {from_prop: stomach, to_prop: digesting, amount: 1}
      - transfer: {from_prop: stomach, to_prop: body_fat, amount: 1}
`);
    const instance = spawn(codex, 'body');

    instance.tick();

    expect(valuesOf(instance, codex), '残り1は先に宣言した輸送が持っていく').toEqual([0, 1, 0]);
  });

  it('to_amountが吸収率になる（出した量と受け取る量が違ってよい）', () => {
    const codex = load(`
object_defs:
  body:
    props:
      digesting: {value: 10, range: {min: 0, max: 64}}
      body_fat: {value: 0, range: {min: 0, max: 1000}}
    passives:
      - transfer: {from_prop: digesting, to_prop: body_fat, amount: 2, to_amount: 3}
`);
    const instance = spawn(codex, 'body');

    instance.tick();

    expect(instance.tryGetProperty(codex.propertyNames.getId('digesting'))?.number ?? 0).toBe(8);
    expect(instance.tryGetProperty(codex.propertyNames.getId('body_fat'))?.number ?? 0).toBe(3);
  });

  it('受け取る側が満杯なら、出す側に残る', () => {
    const codex = load(`
object_defs:
  body:
    props:
      stomach: {value: 10, range: {min: 0, max: 32}}
      digesting: {value: 4, range: {min: 0, max: 5}}
    passives:
      - transfer: {from_prop: stomach, to_prop: digesting, amount: 3}
`);
    const instance = spawn(codex, 'body');

    instance.tick();

    expect(
      instance.tryGetProperty(codex.propertyNames.getId('stomach'))?.number ?? 0,
      '入る1だけが動く',
    ).toBe(9);
    expect(instance.tryGetProperty(codex.propertyNames.getId('digesting'))?.number ?? 0).toBe(5);
  });

  it('conditionsのゲートが閉じている間は動かない', () => {
    const codex = load(`
object_defs:
  body:
    props:
      stomach: {value: 10, range: {min: 0, max: 32}}
      digesting: {value: 0, range: {min: 0, max: 64}}
      nausea: {value: 1, range: {min: 0, max: 1}}
    passives:
      - conditions: [{prop: nausea, lte: 0}]
        transfer: {from_prop: stomach, to_prop: digesting, amount: 1}
`);
    const instance = spawn(codex, 'body');
    const nauseaId = codex.propertyNames.getId('nausea');

    instance.tick();
    expect(instance.tryGetProperty(codex.propertyNames.getId('digesting'))?.number ?? 0).toBe(0);

    instance.tryGetProperty(nauseaId)?.setNumber(0);
    instance.tick();
    expect(instance.tryGetProperty(codex.propertyNames.getId('digesting'))?.number ?? 0).toBe(1);
  });

  it('linked_addは、実際に動いた量に比例して効く', () => {
    const codex = load(`
object_defs:
  body:
    props:
      stomach: {value: 1, range: {min: 0, max: 32}}
      digesting: {value: 0, range: {min: 0, max: 64}}
      warmth: {value: 0, range: {min: 0, max: 100}}
    passives:
      - transfer:
          from_prop: stomach
          to_prop: digesting
          amount: 2
          linked_add:
            self:
              warmth: 4
`);
    const instance = spawn(codex, 'body');

    instance.tick();

    expect(instance.tryGetProperty(codex.propertyNames.getId('stomach'))?.number ?? 0).toBe(0);
    expect(
      instance.tryGetProperty(codex.propertyNames.getId('warmth'))?.number ?? 0,
      '2のうち1しか動かないので半分',
    ).toBe(2);
  });

  it('親のプロパティへも運べる', () => {
    const codex = load(`
object_defs:
  vessel:
    props:
      water: {value: 0, range: {min: 0, max: 100}}
    slots:
      contents:
        cell: {accept: {tag: leaky}}
  drip:
    tags: [leaky]
    props:
      water: {value: 5, range: {min: 0, max: 100}}
    passives:
      - transfer: {from_prop: water, to: parent, to_prop: water, amount: 2}
`);
    const vessel = spawn(codex, 'vessel');
    const drip = new WorldObject(
      nextInstanceId++,
      codex.objects.get(codex.objectNames.getId('drip')),
      session,
    );
    expect(drip.moveToSlot(vessel.getSlot(codex.slotNames.getId('contents')))).toBeUndefined();

    vessel.tick();

    const waterId = codex.propertyNames.getId('water');
    expect([drip.tryGetProperty(waterId)?.number ?? 0, vessel.tryGetProperty(waterId)?.number ?? 0]).toEqual([
      3, 2,
    ]);
  });

  it('対象にactorは書けない（持続的な関係に紐づかないため）', () => {
    expect(() =>
      load(`
object_defs:
  body:
    props:
      stomach: {value: 1, range: {min: 0, max: 32}}
    passives:
      - transfer: {from_prop: stomach, to: actor, to_prop: satiety, amount: 1}
`),
    ).toThrow(YamlLoadError);
  });
});
