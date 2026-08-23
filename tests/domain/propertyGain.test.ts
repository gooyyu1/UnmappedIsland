import { beforeEach, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { InteractionGains } from '../../src/domain/PropertyGain';
import { World } from '../../src/domain/wrappers/World';
import type { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { fixedRng } from '../support/rng';

/**
 * 操作そのものが増やした値の観測（`WorldSession.observeGains`、docs/ui/CardInteraction.md 10.1節）の
 * 自動テスト。回復の粒を出す範囲がここで決まる。
 *
 * 流れるのは**効果が直に書いた分だけ**。同じ操作の経過中にtickが動かした分は、増加ではあっても
 * 「その操作が与えたもの」ではないので出ない——それが見えるように、時間のかかる操作と、経過中に
 * 動く値の両方を宣言してある。
 */
describe('操作が増やした値の観測', () => {
  const yaml = `
traits:
  liquid_container:
    tags: [liquid_container]
  liquid:
    tags: [liquid]
    props:
      density: {value: 1}
  water_liquid:
    actions:
      drink:
        add: {actor: {hydration: 120}}
        set: {self: {fill: 0}}

object_defs:
  world:
    singleton: true
    props:
      minutes_per_tick: {value: 15}
      minute: {value: 0, range: {min: 0, max: 60}, on_max: {add: {self: {minute: -60, hour: 1}}}}
      hour: {value: 0, range: {min: 0, max: 24}, on_max: {add: {self: {hour: -24, day: 1}}}}
    slots:
      locations: {cell: {accept: {tag: place}}}

  land:
    tags: [place]
    slots:
      characters: {cell: {accept: {tag: character}}}

  survivor:
    tags: [character]
    slots:
      hand: {cell: {accept: {tag: item}}}
    props:
      stamina: {value: 100, range: {min: 0, max: 100}}
      # 何もしなくても毎tick減る。休憩の経過中にも動くので、増加として流れないことが見える。
      wakefulness:
        value: 100
        range: {min: 0, max: 100}
        passives:
          - add: {self: {wakefulness: -1}}
      satiety: {value: 1000, range: {min: 0, max: 2000}}
      # 在庫から遅れて増えるので、操作そのものが書いた先には現れない（DigestionSystem.md 3節）。
      carbohydrate:
        value: 100
        range: {min: 0, max: 500}
        passives:
          - conditions: [{prop: carbohydrate, gt: 0}]
            add: {self: {body_fat: 1}}
      body_fat: {value: 0, range: {min: 0, max: 1000}}
      hydration: {value: 100, range: {min: 0, max: 500}}
    actions:
      rest:
        duration: 60
        add: {self: {stamina: 10}}
      wait:
        duration: 15

  roasted_taro:
    tags: [item]
    actions:
      eat:
        duration: 15
        destroy: self
        add: {actor: {satiety: 550, carbohydrate: 48}}

  bowl:
    tags: [item]
    traits: [liquid_container]
    props:
      weight: {value: 200}
      fill: {value: 0, range: {min: 0, max: 250}, on_min: {become: {content: none}}}
    variation_axes:
      content: {of: {tag: liquid}}

  water_liquid:
    traits: [liquid, water_liquid]
`;

  let codex: WorldCodex;
  let session: WorldSession;
  let player: WorldObject;

  beforeEach(() => {
    const loader = new WorldCodexYamlLoader();
    loader.load('gains.yaml', yaml);
    codex = loader.build();

    session = new WorldSession(codex, undefined, fixedRng(0));
    const world = spawn('world');
    session.adoptWorld(new World(world, codex));
    const land = spawn('land');
    expect(land.moveToSlot(world.getSlot(codex.slotNames.getId('locations')))).toBeUndefined();
    player = spawn('survivor');
    expect(player.moveToSlot(land.getSlot(codex.slotNames.getId('characters')))).toBeUndefined();
  });

  function spawn(objectName: string): WorldObject {
    return session.spawn(codex.objectNames.getId(objectName));
  }

  /** bodyの間に観測された増加を、プロパティ名から量で引ける形にする。 */
  function gainsDuring(body: () => void): { source: string; amounts: Map<string, number> } {
    const observed: InteractionGains[] = [];
    session.observeGains((gains) => observed.push(gains), body);

    const amounts = new Map<string, number>();
    for (const { gains } of observed)
      for (const gain of gains) if (gain.object === player) amounts.set(gain.property.name, gain.amount);
    return { source: observed[0]?.source[0].def.name ?? '', amounts };
  }

  /** 満タンだと足した分がそのまま戻されるので、増加を見るテストは先に減らしておく。 */
  function drain(propertyName: string, to: number): void {
    player.tryGetProperty(codex.propertyNames.getId(propertyName))?.setNumber(to);
  }

  it('効果が直に書いた値だけが現れ、経過中のtickが動かした分は現れない', () => {
    drain('stamina', 50);

    // 休憩は60分（4 tick）かかり、その間に覚醒度が-1/tickずつ減る。
    const { amounts } = gainsDuring(() => {
      expect(player.tryGetAction('rest', player)?.tryExecute() === true).toBe(true);
    });

    expect(amounts.get('stamina'), '効果が足した分がそのまま出る').toBe(10);
    expect(amounts.has('wakefulness'), '経過中に減った分は増加ではないので出ない').toBe(false);
  });

  it('効果が書いた先がそのまま出る（食べたらかさと栄養素の両方）', () => {
    drain('carbohydrate', 0);
    drain('satiety', 0);
    const taro = spawn('roasted_taro');
    expect(taro.moveToSlot(player.getSlot(codex.slotNames.getId('hand')))).toBeUndefined();

    const { source, amounts } = gainsDuring(() => {
      expect(taro.tryGetAction('eat', player)?.tryExecute() === true).toBe(true);
    });

    expect(source, '発生源は操作を宣言していた札').toBe('roasted_taro');
    expect(amounts.get('satiety'), 'かさ（mL）').toBe(550);
    expect(amounts.get('carbohydrate'), '中身（tick）').toBe(48);
    // 体脂肪は在庫から遅れて増えるので、操作そのものが書いた先には現れない。
    expect(amounts.has('body_fat')).toBe(false);
  });

  it('出どころは、飲み干して型が変わった器でも、同じ札を指し続ける', () => {
    // 中身入りの器は1つの型（3.5節）で、飲み干すと素の型（空の器）へ戻る。**変わるのは型だけで
    // 個体は続く**ので、湧かせる札は型が変わった後も同じ札のまま。
    drain('hydration', 100);
    const bowl = spawn('bowl');
    expect(bowl.moveToSlot(player.getSlot(codex.slotNames.getId('hand')))).toBeUndefined();
    bowl.becomeAlong(new Map([['content', 'water_liquid']]));
    bowl.tryGetProperty(codex.propertyNames.getId('fill'))?.setNumber(250);

    const observed: InteractionGains[] = [];
    session.observeGains(
      (gains) => observed.push(gains),
      () => {
        expect(bowl.tryGetAction('drink', player)?.tryExecute() === true).toBe(true);
      },
    );

    expect(bowl.def.name, '飲み干した器は空へ戻っている').toBe('bowl');
    expect(observed[0].source.map((object) => object.def.name)).toEqual([
      'bowl',
      'survivor',
      'land',
      'world',
    ]);
  });

  it('上限で押し戻された分は増加に数えない', () => {
    // 満タンの体力へ休憩を足すと、上限のクランプが同じ値へ書き戻す。正味は0なので流れない。
    const { amounts } = gainsDuring(() => {
      expect(player.tryGetAction('rest', player)?.tryExecute() === true).toBe(true);
    });

    expect(amounts.has('stamina')).toBe(false);
  });

  it('観測していない間の操作は溜め置かれない', () => {
    expect(player.tryGetAction('wait', player)?.tryExecute() === true).toBe(true);

    const { amounts } = gainsDuring(() => {
      /* 何もしない */
    });

    expect(amounts.size).toBe(0);
  });
});
