import { beforeEach, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import type { WorldChange } from '../../src/domain/runtime/WorldChange';
import { WorldObject } from '../../src/domain/runtime/WorldObject';
import { WorldSession } from '../../src/domain/runtime/WorldSession';
import { World } from '../../src/domain/runtime/views/World';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { fixedRng } from '../support/rng';

/**
 * 世界に起きた物の出入りの観測（WorldSession.observeChanges・WorldChange）の自動テスト。
 *
 * 狙いは「誰が何をしたか」を、pickのどの候補が選ばれたかを知らずに読めること
 * （docs/engine/HuntingSystem.md 6節）。定義はこのファイル専用の最小Codexで書き、実データの
 * 値の変更に引きずられないようにする。
 */
describe('WorldSession.observeChanges(物の出入りの観測)', () => {
  const YAML = `
object_defs:
  world:
    # Worldのビューが要求する時計の語彙（値は動かさないので初期値だけ）。
    props:
      day: {value: 0}
      hour: {value: 0}
      minute: {value: 0}
      minutes_per_tick: {value: 15}
    slots:
      locations: {cell: {accept: {tag: location}}}
  ground:
    tags: [location]
    slots:
      items: {cell: {accept: {tag: item}}}
      beasts: {cell: {accept: {tag: beast}}}
  stone:
    tags: [item]
    props:
      volume: {value: 100}
  basket:
    tags: [item]
    props:
      volume: {value: 500}
    slots:
      contents: {cell: {accept: {tag: item}}}
  # 重ねた物を「壊す」か「取り上げる」のどちらかを引く獣。観測する側はこの分岐を知らない。
  beast:
    tags: [beast]
    slots:
      loot: {cell: {accept: {tag: item}}}
    combinations:
      rampage:
        with: item
        pick:
          - weight: 60
            destroy: dragged
          - weight: 40
            move: {object: dragged, to: self}
`;

  /** 壊す側（重み60）を引くrollと、取り上げる側（重み40）を引くroll。 */
  const SMASHES = 0.5;
  const TAKES = 0.95;

  let codex: WorldCodex;
  let session: WorldSession;
  let ground: WorldObject;
  let changes: WorldChange[];

  beforeEach(() => {
    codex = new WorldCodexYamlLoader().load('changes.yaml', YAML).build();
    open(SMASHES);
  });

  /** 土地1つだけの世界から始める。rollはpickがどの候補を引くかを決める（fixedRng）。 */
  function open(roll: number): void {
    session = new WorldSession(codex, undefined, fixedRng(roll));
    const worldInstance = new WorldObject(0, codex.objects.get(codex.objectNames.getId('world')), session);
    session.adoptWorld(new World(worldInstance, codex.propertyNames, codex.symbolNames));
    ground = spawn('ground');
    expect(ground.moveToSlot(worldInstance, slot('locations'))).toBeUndefined();
    changes = [];
  }

  const slot = (name: string): number => codex.slotNames.getId(name);
  const spawn = (name: string): WorldObject => session.spawn(codex.objectNames.getId(name));

  /** その名前のオブジェクトを生成し、地面へ置く。 */
  function placeOnGround(name: string, slotName = 'items'): WorldObject {
    const object = spawn(name);
    expect(object.moveToSlot(ground, slot(slotName))).toBeUndefined();
    return object;
  }

  /** bodyの実行中に起きた出入りを、読みやすい形（誰が・何を・どこからどこへ）で並べる。 */
  function observe(body: () => void): string[] {
    session.observeChanges((change) => changes.push(change), body);
    const place = (p: WorldChange['from']): string =>
      p === undefined ? '—' : `${p.parent.def.name}.${codex.slotNames.getName(p.slotGlobalId)}`;
    return changes.map(
      (c) => `${c.subject?.def.name ?? '—'}: ${c.object.def.name} ${place(c.from)} → ${place(c.to)}`,
    );
  }

  it('プレイヤーが直に動かした分は、主体を持たない', () => {
    // カードのドラッグやシナリオの開始状態がこれ。世界の側に主体が居ないことをundefinedで表す。
    const stone = spawn('stone');

    const seen = observe(() => {
      expect(stone.moveToSlot(ground, slot('items'))).toBeUndefined();
    });

    expect(seen).toEqual(['—: stone — → ground.items']);
  });

  it('生まれたことは、移動前の居場所が無いこととして現れる', () => {
    const seen = observe(() => placeOnGround('stone'));

    expect(seen).toEqual(['—: stone — → ground.items']);
  });

  it('観測していない間の出入りは残らない（溜め置きはしない）', () => {
    placeOnGround('stone');

    const seen = observe(() => {
      // 何もしない。
    });

    expect(seen).toEqual([]);
  });

  it('効果が起こした出入りには、その効果を宣言していたオブジェクトが主体として付く', () => {
    // 引いたのは「壊す」側。観測する側はどちらが引かれたかを知らない。
    const beast = placeOnGround('beast', 'beasts');
    const stone = placeOnGround('stone');

    const seen = observe(() => {
      expect(beast.tryExecuteCombination(stone, undefined, 'rampage', session)).toBe(true);
    });

    expect(seen).toEqual(['beast: stone ground.items → —']);
  });

  it('同じ操作でも、引いた候補が違えば違う出来事として現れる', () => {
    // 壊したのか取り上げたのかが、分岐を見ずに区別できる——これが、分岐そのものを観測しない理由。
    open(TAKES);
    const beast = placeOnGround('beast', 'beasts');
    const stone = placeOnGround('stone');

    const seen = observe(() => {
      expect(beast.tryExecuteCombination(stone, undefined, 'rampage', session)).toBe(true);
    });

    expect(seen).toEqual(['beast: stone ground.items → beast.loot']);
  });

  it('2匹が別々に動いても、どちらの仕業かが分かれる', () => {
    // 前後の比較では決められない唯一の場合（WorldChange参照）。同じ型・同じ変化なので、
    // 差分に見えるのは「石が2つ消えた」だけになる。
    const first = placeOnGround('beast', 'beasts');
    const second = placeOnGround('beast', 'beasts');
    const stones = [placeOnGround('stone'), placeOnGround('stone')];

    observe(() => {
      expect(first.tryExecuteCombination(stones[0], undefined, 'rampage', session)).toBe(true);
      expect(second.tryExecuteCombination(stones[1], undefined, 'rampage', session)).toBe(true);
    });

    expect(changes.map((c) => c.subject)).toEqual([first, second]);
    expect(changes.map((c) => c.object)).toEqual(stones);
  });

  it('壊れた入れ物の中身がこぼれ出た分も、壊れた側の仕業として並ぶ', () => {
    // destroyは中身を親へこぼす（9.3節）。こぼれ出しも1件の出入りなので、同じ主体で記録される。
    const beast = placeOnGround('beast', 'beasts');
    const basket = placeOnGround('basket');
    const stone = spawn('stone');
    expect(stone.moveToSlot(basket, slot('contents'))).toBeUndefined();

    const seen = observe(() => {
      expect(beast.tryExecuteCombination(basket, undefined, 'rampage', session)).toBe(true);
    });

    expect(seen).toEqual(['beast: stone basket.contents → ground.items', 'beast: basket ground.items → —']);
  });

  it('観測は入れ子にでき、抜けると外側へ戻る', () => {
    // observeTicksと同じ規約。解除を呼び出し側に任せない。
    const outer: string[] = [];
    const inner: string[] = [];

    session.observeChanges(
      (c) => outer.push(c.object.def.name),
      () => {
        placeOnGround('stone');
        session.observeChanges(
          (c) => inner.push(c.object.def.name),
          () => placeOnGround('basket'),
        );
        placeOnGround('stone');
      },
    );

    expect(inner, '内側が観測している間は内側だけへ流れる').toEqual(['basket']);
    expect(outer, '抜けた後は外側へ戻る').toEqual(['stone', 'stone']);
  });

  it('worldは1度しか結び付けられない', () => {
    // 2度目には、既にそのworldで動き出したオブジェクトが居るはず（WorldSession.adoptWorld）。
    const other = new World(
      new WorldObject(9, codex.objects.get(codex.objectNames.getId('world')), session),
      codex.propertyNames,
      codex.symbolNames,
    );

    expect(() => session.adoptWorld(other)).toThrow(/1度/);
  });
});
