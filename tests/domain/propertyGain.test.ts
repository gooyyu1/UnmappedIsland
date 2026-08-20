import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { InteractionGains } from '../../src/domain/PropertyGain';
import { World } from '../../src/domain/views/World';
import type { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { fixedRng } from '../support/rng';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * 操作そのものが増やした値の観測（`WorldSession.observeGains`、docs/ui/CardInteraction.md 10.1節）を、
 * 実ファイルの定義だけで検証する。回復の粒を出す範囲がここで決まる。
 */
describe('操作が増やした値の観測', () => {
  let codex: WorldCodex;
  let session: WorldSession;
  let world: WorldObject;
  let player: WorldObject;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
  });

  beforeEach(() => {
    session = new WorldSession(codex, undefined, fixedRng(0));
    world = spawn('world');
    session.adoptWorld(new World(world, codex.propertyNames, codex.symbolNames));
    const beach = spawn('sandy_beach');
    expect(beach.moveToSlot(world, codex.slotNames.getId('locations'))).toBeUndefined();
    player = spawn(SAMPLE_CHARACTER);
    expect(player.moveToSlot(beach, codex.slotNames.getId('characters'))).toBeUndefined();
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

    // 休憩は60分（4 tick）かかり、その間に覚醒度が-1/tickずつ減る（characters/）。
    const { amounts } = gainsDuring(() => {
      expect(player.tryExecuteAction('rest', player)).toBe(true);
    });

    expect(amounts.get('stamina'), '効果が足した分がそのまま出る').toBe(10);
    expect(amounts.has('wakefulness'), '経過中に減った分は増加ではないので出ない').toBe(false);
  });

  it('効果が書いた先がそのまま出る（食べたらかさと栄養素の両方）', () => {
    drain('carbohydrate', 0);
    drain('satiety', 0);
    const taro = spawn('roasted_taro');
    expect(taro.moveToSlot(player, codex.slotNames.getId('hand'))).toBeUndefined();

    const { source, amounts } = gainsDuring(() => {
      expect(taro.tryExecuteAction('eat', player)).toBe(true);
    });

    expect(source, '発生源は操作を宣言していた札').toBe('roasted_taro');
    expect(amounts.get('satiety'), 'かさ（mL）').toBe(550);
    expect(amounts.get('carbohydrate'), '中身（tick）').toBe(48);
    // 体脂肪は在庫から遅れて増えるので、操作そのものが書いた先には現れない（DigestionSystem.md 3節）。
    expect(amounts.has('body_fat')).toBe(false);
  });

  it('出どころは、飲み干して型が変わった器でも、同じ札を指し続ける', () => {
    // 中身入りの器は1つの型（3.5節）で、飲み干すと素の型（空の器）へ戻る。**変わるのは型だけで
    // 個体は続く**ので、湧かせる札は型が変わった後も同じ札のまま。
    drain('hydration', 100);
    const bowl = spawn('coconut_bowl');
    expect(bowl.moveToSlot(player, codex.slotNames.getId('hand'))).toBeUndefined();
    bowl.becomeAlong(new Map([['content', 'water_liquid']]));
    bowl.tryGetProperty(codex.propertyNames.getId('fill'))?.setNumber(250);

    const observed: InteractionGains[] = [];
    session.observeGains(
      (gains) => observed.push(gains),
      () => {
        expect(bowl.tryExecuteAction('drink', player)).toBe(true);
      },
    );

    expect(bowl.def.name, '飲み干した器は空へ戻っている').toBe('coconut_bowl');
    expect(observed[0].source.map((object) => object.def.name)).toEqual([
      'coconut_bowl',
      SAMPLE_CHARACTER,
      'sandy_beach',
      'world',
    ]);
  });

  it('上限で押し戻された分は増加に数えない', () => {
    // 満タンの体力へ休憩を足すと、上限のクランプが同じ値へ書き戻す。正味は0なので流れない。
    const { amounts } = gainsDuring(() => {
      expect(player.tryExecuteAction('rest', player)).toBe(true);
    });

    expect(amounts.has('stamina')).toBe(false);
  });

  it('観測していない間の操作は溜め置かれない', () => {
    expect(player.tryExecuteAction('wait', player)).toBe(true);

    const { amounts } = gainsDuring(() => {
      /* 何もしない */
    });

    expect(amounts.size).toBe(0);
  });
});
