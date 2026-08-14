import { describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { WorldObject } from '../../src/domain/runtime/WorldObject';
import { WorldSession } from '../../src/domain/runtime/WorldSession';
import { YamlLoadError } from '../../src/loader/YamlLoadError';
import { StubRng } from '../support/StubRng';
import { SeededRng } from '../support/SeededRng';

// rangeイベント（on_shortfall等）の直下にpickを書ける文法（GameElementDefinition.md 9.7節・10節）の
// 自動テスト。気候システム（ClimateSystem.md）の「残り時間が0に達した瞬間、プロパティ参照の重みで
// 次の状態を抽選し、残り時間自体も再ロールする」パターンがこの文法に依存する。
describe('rangeイベントのpick文法', () => {
  function load(yaml: string): WorldCodex {
    return new WorldCodexYamlLoader().load('test.yaml', yaml).build();
  }

  function instantiate(codex: WorldCodex, objectDefName: string, session: WorldSession): WorldObject {
    return new WorldObject(1, codex.objects.get(codex.objectNames.getId(objectDefName)), session);
  }

  it('プロパティ参照のweightで候補を選び、選ばれた候補がcounter自身を再ロールする', () => {
    // 0/1の重みプロパティ参照は、そのまま決定的な条件分岐になる（重み0の候補は選ばれない）。
    // 選ばれた候補はcounter自身を再ロールし、次の周回に備える（気候の季節・天気遷移と同じ形）。
    // weightが0/1しかないため抽選結果は乱数値によらず決定的に定まる。StubRngは
    // 「pickが発火するたびに1回ずつnextDoubleが呼ばれる」ことだけを保証すれば十分なので、
    // 値そのものは範囲内であれば何でもよい([0, 1)内の任意の値)。
    const yaml = `
object_defs:
  cycler:
    props:
      go_a:
        value: 1
      go_b:
        value: 0
      chosen:
        value: 0
      counter:
        value: 3
        range: {min: 1, max: 999}
        passives:
          - add:
              self:
                counter: -1
        on_shortfall:
          pick:
            - weight: {prop: go_a}
              set:
                self: {counter: 10, chosen: 1}
            - weight: {prop: go_b}
              set:
                self: {counter: 20, chosen: 2}
`;
    const codex = load(yaml);
    const session = new WorldSession(codex, undefined, new StubRng({ doubles: [0.5, 0.5] }));
    const cycler = instantiate(codex, 'cycler', session);
    const counterId = codex.propertyNames.getId('counter');
    const chosenId = codex.propertyNames.getId('chosen');

    for (let i = 0; i < 3; i++) cycler.tick(session);

    expect(cycler.getNumber(chosenId)).toBe(1); // 重み1のgo_a候補だけが選ばれる
    expect(cycler.getNumber(counterId)).toBe(10); // 選ばれた候補がcounter自身を再ロールする

    // 重みを入れ替えると、次の発火では反対の候補が選ばれる
    cycler.setProperty(codex.propertyNames.getId('go_a'), 0);
    cycler.setProperty(codex.propertyNames.getId('go_b'), 1);
    for (let i = 0; i < 10; i++) cycler.tick(session);

    expect(cycler.getNumber(chosenId)).toBe(2);
    expect(cycler.getNumber(counterId)).toBe(20);
  });

  it('on_shortfall配下のpick候補（ネストを含む）にparent対象を書くとロードエラーになる', () => {
    // on_shortfall配下のpick候補（ネストを含む）の効果対象はselfのみ（6.3節の制約をそのまま引き継ぐ）
    const yaml = `
object_defs:
  broken:
    props:
      counter:
        value: 3
        range: {min: 1, max: 999}
        on_shortfall:
          pick:
            - weight: 1
              pick:
                - weight: 1
                  set:
                    parent: {counter: 10}
`;
    expect(() => load(yaml)).toThrow(YamlLoadError);
  });

  it('on_shortfallにactiveとpickを同時に書くとロードエラーになる', () => {
    const yaml = `
object_defs:
  broken:
    props:
      counter:
        value: 3
        range: {min: 1, max: 999}
        on_shortfall:
          set:
            self: {counter: 10}
          pick:
            - weight: 1
              set:
                self: {counter: 20}
`;
    expect(() => load(yaml)).toThrow(YamlLoadError);
  });

  it('on_shortfall: {} という空宣言は、既定の下限クランプをエラーなく打ち消す', () => {
    // 「宣言だけして何もしない」on_shortfall: {}。既定の下限クランプが打ち消され、
    // 値が下限を下回ったまま残ることを許容する。
    const yaml = `
object_defs:
  sinker:
    props:
      level:
        value: 5
        range: {min: 0, max: 10}
        on_shortfall: {}
        passives:
          - add:
              self:
                level: -2
`;
    const codex = load(yaml);
    // このテストにpickは無くrngは使われないが、原文のnew Random(1)をそのまま踏襲する。
    const session = new WorldSession(codex, undefined, new SeededRng(1));
    const sinker = instantiate(codex, 'sinker', session);
    const levelId = codex.propertyNames.getId('level');

    for (let i = 0; i < 3; i++) sinker.tick(session);

    // 5 -> 3 -> 1 -> -1。既定クランプなら0で止まるが、空宣言により素通しになる
    expect(sinker.getNumber(levelId)).toBe(-1);
  });
});
