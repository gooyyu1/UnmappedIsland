import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { WorldObject } from '../../src/domain/WorldObject';
import type { StartedGame } from '../../src/domain/generation/NewGame';
import { startNewGame } from '../../src/domain/generation/NewGame';
import { seededRng } from '../../src/domain/Rng';
import { bundledCodex, SAMPLE_CHARACTER } from '../support/worldCodexFiles';

/**
 * **貯め込み（キャッシュ）を入れずに毎回導出していることの値段**を、物が出揃った世界で測る。見るのは
 * 2つ——担いだ木を辿って出す `weight`/`load` の実効値
 * （[`ContainerSystem.md`](../../docs/engine/ContainerSystem.md) 4.1節）と、札を掴んだ瞬間に並んでいる
 * 札1枚ずつへ問う組み合わせ（[`ActionSystem.md`](../../docs/engine/ActionSystem.md) 1.3節）。
 * **入れずに済むことを言えるのは、ここの上限が緑であることだけ。**
 *
 * **測るのは物が出揃った状態。** 現在地には世界にあるアイテムの型を1つずつ積み、担ぎ手にはそり1台ぶんの
 * 入れ子を持たせる。どちらも遊んで届く数より多いので、**これで収まるなら遊びの途中では収まる。**
 *
 * **上限は1フレーム（16ms）では引かない。** 今の値との開きが大きすぎて、伸び方が枚数の2乗へ変わっても
 * 緑のまま通る。引くのは**桁の変わった遅さが落ちる幅**で、実際に導出を100倍に重くして両方が赤くなる
 * ことを見ている。
 *
 * **時間を見る試験なので、採るのは繰り返した中の最小値。** GCも他のプロセスも足すことしかしないので、
 * 最小値がその機械での素の値にいちばん近い。繰り返す回数は、最適化が掛かった後の値へ落ち着くまで回す
 * ぶん——数回では、温まっていない側の値しか見ない。
 */
describe('貯め込まずに毎回導出することの値段', () => {
  let codex: WorldCodex;

  beforeAll(() => {
    codex = bundledCodex();
  });

  /** 3は開始地点が砂浜になるシード（同梱シナリオと揃える）。 */
  const SEED = 3;

  function newGame(): StartedGame {
    return startNewGame(codex, SAMPLE_CHARACTER, SEED, seededRng(SEED));
  }

  function create(game: StartedGame, defName: string): WorldObject {
    return game.session.createObject(codex.objectNames.getId(defName));
  }

  /** 現在地に、世界にあるアイテムの型を1つずつ積む。同じ型は1枚の札にまとまるので、型の数＝札の数。 */
  function pileEveryItemType(game: StartedGame): number {
    let placed = 0;
    for (const defName of codex.objectDefNamesWithTag(codex.vocabulary.world.itemTagId)) {
      if (game.startLocation.receiveItem(create(game, defName))) placed++;
    }
    return placed;
  }

  /**
   * 担ぎ手にそりを持たせ、そりの中を籠で、籠の中を石で埋める。返すのは担いだ木に居る物の数。
   * どちらの入れ子も、かさ（`capacity`）が断ったところで止まる。
   */
  function loadSledge(game: StartedGame): number {
    const contentsSlotId = codex.slotNames.getId('contents');
    const sledge = create(game, 'sledge');
    expect(game.player.take(sledge), 'そりを手に持てる').toBe(true);

    let carried = 1;
    for (;;) {
      const basket = create(game, 'woven_basket');
      if (basket.moveToSlotOrRejection(sledge.getSlot(contentsSlotId)) !== undefined) return carried;
      carried++;
      for (;;) {
        const stone = create(game, 'stone');
        if (stone.moveToSlotOrRejection(basket.getSlot(contentsSlotId)) !== undefined) break;
        carried++;
      }
    }
  }

  /** bodyをtimes回走らせ、いちばん短かった1回のミリ秒を返す。 */
  function fastestMilliseconds(times: number, body: () => void): number {
    let fastest = Infinity;
    for (let i = 0; i < times; i++) {
      const startedAt = performance.now();
      body();
      fastest = Math.min(fastest, performance.now() - startedAt);
    }
    return fastest;
  }

  /**
   * 担いだ木を辿って出す `weight`/`load` の実効値（`ContainerSystem.md` 4節）。読むたびに部分木を
   * 辿り直す——控えが効くのは1回の読み取りの中だけ（`EffectiveValueReading`）。
   */
  it('担いだ荷を辿って重さを出すのは、貯め込まなくても0.5ミリ秒に収まる', () => {
    const game = newGame();
    const carried = loadSledge(game);
    expect(carried, '担げるだけ担いだ木').toBeGreaterThan(100);

    const player = game.player.instance;
    const weight = player.tryGetProperty(codex.vocabulary.engine.weightId);
    const load = player.tryGetProperty(codex.vocabulary.engine.loadId);
    expect(weight, '担ぎ手はweightを名乗る').toBeDefined();
    expect(load, '担ぎ手はloadを名乗る').toBeDefined();

    const milliseconds = fastestMilliseconds(200, () => {
      weight!.getEffectiveValue();
      load!.getEffectiveValue();
    });

    expect(milliseconds, `担いだ木${carried}物ぶんの重さの集計（${milliseconds}ms）`).toBeLessThan(0.5);
  });

  /**
   * 並んでいる札すべてへ、掴んだ物との組み合わせを両向きに問う（`cardOperations.combinationBetween`
   * と同じ引き方）。落とされる側と掴んだ側の両方から、成立するものと断るものを引く。
   */
  function askEveryCard(targets: readonly WorldObject[], dragged: WorldObject, agent: WorldObject): void {
    for (const target of targets) {
      target.combinationsWith(dragged, agent);
      target.refusedCombinationsWith(dragged, agent);
      dragged.combinationsWith(target, agent);
      dragged.refusedCombinationsWith(target, agent);
    }
  }

  /**
   * 掴んだ物との組み合わせを1つ以上返す札の数。**要件（`conditions`）が評価されたのはこれらの札**
   * ——相手として受け入れる宣言を持たない札は、型のタグを照らし合わせたところで候補が空になり、
   * 要件まで届かない。
   */
  function cardsReachingConditions(
    targets: readonly WorldObject[],
    dragged: WorldObject,
    agent: WorldObject,
  ): number {
    return targets.filter(
      (target) =>
        target.combinationsWith(dragged, agent).length +
          target.refusedCombinationsWith(dragged, agent).length +
          dragged.combinationsWith(target, agent).length +
          dragged.refusedCombinationsWith(target, agent).length >
        0,
    ).length;
  }

  /**
   * 掴んだ瞬間にふちを光らせる走査（`CardDragController.showAcceptingCards`）が、並んでいる札1枚ずつへ
   * 問う組み合わせ。
   *
   * **測るのは、いちばん多くの札と噛み合う物を掴んだ場合。** 何を掴むかで要件が評価される札の数が
   * 変わるので、並びの先頭のような暗黙の選び方では、噛み合う宣言を1つも持たない物を掴んで
   * **タグの照合だけを測る**ことになる。掴む物はその場で選び直し、**要件まで届いた札の数を
   * 併せて確かめる**——世界の宣言が変わって届かなくなったら、測っている面が抜けたことが赤で出る。
   *
   * ここが見るのは**問われた側の判定だけ**で、走査を回す画面側の値段ではない。そちらは
   * [issue #2255](https://github.com/gooyyu1/UnmappedIsland/issues/2255) が持つ。
   */
  it('掴んだ瞬間に全札へ問う組み合わせは、貯め込まなくても4ミリ秒に収まる', () => {
    const game = newGame();
    const cards = pileEveryItemType(game);
    expect(cards, '世界にあるアイテムの型が1枚ずつ並ぶ').toBeGreaterThan(100);

    const agent = game.player.instance;
    const targets = game.startLocation.items;
    const [{ dragged, reaching }] = targets
      .map((dragged) => ({ dragged, reaching: cardsReachingConditions(targets, dragged, agent) }))
      .sort((a, b) => b.reaching - a.reaching);

    expect(reaching, `要件まで届いた札（掴んだのは'${dragged.def.name}'）`).toBeGreaterThan(40);

    const milliseconds = fastestMilliseconds(50, () => {
      askEveryCard(targets, dragged, agent);
    });

    expect(
      milliseconds,
      `'${dragged.def.name}'を掴んだときの${cards}枚ぶんの判定（${milliseconds}ms）`,
    ).toBeLessThan(4);
  });
});
