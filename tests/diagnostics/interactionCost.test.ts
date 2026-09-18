import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { WorldObject } from '../../src/domain/WorldObject';
import type { StartedGame } from '../../src/domain/generation/NewGame';
import { startNewGame } from '../../src/domain/generation/NewGame';
import { seededRng } from '../../src/domain/Rng';
import { bundledCodex, SAMPLE_CHARACTER } from '../support/worldCodexFiles';

/**
 * **貯め込み（キャッシュ）を入れずに毎回導出していることの値段**を測る。見るのは2つ——担いだ木を
 * 辿って出す `weight`/`load` の実効値（[`ContainerSystem.md`](../../docs/engine/ContainerSystem.md)
 * 4.1節）と、札を掴んだ瞬間に並んでいる札1枚ずつへ問う組み合わせ
 * （[`ActionSystem.md`](../../docs/engine/ActionSystem.md) 1.3節）。**入れずに済むことを言えるのは、
 * ここが緑であることだけ。**
 *
 * **2つは、規模の頭打ちが在るかで見方が違う。**
 *
 * - **重さは頭打ちが在る。** 辿るのは担ぎ手が抱えている木で、手の枠の数といちばん大きい入れ物の
 *   かさが上限を決める。そこまで積んだ状態を組んで、**値そのもの**に上限を引く。
 * - **札の枚数に頭打ちは無い。** 束ねない型（`stackable: false`）は個体ごとに1枚の札になるので、
 *   同じ型を並べればいくらでも増える。だから「この枚数で収まった」では何も言えない——**枚数を倍に
 *   しても時間が倍までしか増えないこと**（2乗なら4倍）を見る。伸び方への上限なので、機械の速さにも
 *   将来の型の数にも左右されない。
 *
 * **上限は1フレーム（16ms）では引かない。** 今の値との開きが大きすぎて、伸び方が変わっても緑のまま
 * 通る。引くのは**桁の変わった遅さが落ちる幅**で、実際に導出を100倍に重くして両方が赤くなることを
 * 見ている。
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

  /** 札を並べる枚数と、その倍。倍にしても時間が倍までしか増えないことを見る。 */
  const CARDS = 150;

  function newGame(): StartedGame {
    return startNewGame(codex, SAMPLE_CHARACTER, SEED, seededRng(SEED));
  }

  function create(game: StartedGame, defName: string): WorldObject {
    return game.session.createObject(codex.objectNames.getId(defName));
  }

  /**
   * 現在地に札を`wanted`枚並べ、それぞれの代表を返す。まず世界にあるアイテムの型を1つずつ置き
   * （型が違えば束ねられない）、足りないぶんは**束ねない型**を足す——同じ型でも個体ごとに1枚の札に
   * なるので、枚数は型の数で頭打ちにならない。
   */
  function pileCards(game: StartedGame, wanted: number): readonly WorldObject[] {
    const cardCount = (): number => game.startLocation.itemStacks.length;
    for (const defName of codex.objectDefNamesWithTag(codex.vocabulary.world.itemTagId)) {
      if (cardCount() >= wanted) break;
      game.startLocation.receiveItem(create(game, defName));
    }
    while (cardCount() < wanted) game.startLocation.receiveItem(create(game, 'woven_basket'));

    return game.startLocation.itemStacks.map((stack) => stack[0]);
  }

  /**
   * 担ぎ手の手の枠をすべて、いちばん大きい入れ物（`handcart`）で埋め、その中を籠で、籠の中を石で
   * 埋める。返すのは担いだ木に居る物の数。**これが1人に載る上限**——枠もかさも宣言が決めていて、
   * 遊んでこれ以上は積めない。
   */
  function loadEveryHandCell(game: StartedGame): number {
    const contentsSlotId = codex.slotNames.getId('contents');
    let carried = 0;

    for (;;) {
      const cart = create(game, 'handcart');
      if (!game.player.take(cart)) return carried;
      carried++;
      for (;;) {
        const basket = create(game, 'woven_basket');
        if (basket.moveToSlotOrRejection(cart.getSlot(contentsSlotId)) !== undefined) break;
        carried++;
        for (;;) {
          const stone = create(game, 'stone');
          if (stone.moveToSlotOrRejection(basket.getSlot(contentsSlotId)) !== undefined) break;
          carried++;
        }
      }
    }
  }

  /** bodyをtimes回走らせ、いちばん短かった1回のミリ秒を返す。 */
  function fastestMilliseconds(times: number, body: () => void): number {
    return fastestEach(times, body, () => {}).first;
  }

  /**
   * 2つをtimes回ずつ**交互に**走らせ、それぞれのいちばん短かった1回のミリ秒を返す。
   *
   * **交互にするのは、2つの比を見るため。** 順に測ると、先に測ったほうは最適化が掛かっていない
   * ぶん遅く出る。その差がそのまま比に乗ると、比への上限が意味を失う。
   */
  function fastestEach(
    times: number,
    first: () => void,
    second: () => void,
  ): { first: number; second: number } {
    const fastest = { first: Infinity, second: Infinity };
    for (let i = 0; i < times; i++) {
      const firstStartedAt = performance.now();
      first();
      fastest.first = Math.min(fastest.first, performance.now() - firstStartedAt);

      const secondStartedAt = performance.now();
      second();
      fastest.second = Math.min(fastest.second, performance.now() - secondStartedAt);
    }
    return fastest;
  }

  /**
   * 担いだ木を辿って出す `weight`/`load` の実効値（`ContainerSystem.md` 4節）。読むたびに部分木を
   * 辿り直す——控えが効くのは1回の読み取りの中だけ（`EffectiveValueReading`）。
   */
  it('担げるだけ担いだ荷を辿って重さを出すのは、貯め込まなくても2ミリ秒に収まる', () => {
    const game = newGame();
    const carried = loadEveryHandCell(game);
    expect(carried, '手の枠を埋め尽くした木').toBeGreaterThan(500);

    const player = game.player.instance;
    const weight = player.tryGetProperty(codex.vocabulary.engine.weightId);
    const load = player.tryGetProperty(codex.vocabulary.engine.loadId);
    expect(weight, '担ぎ手はweightを名乗る').toBeDefined();
    expect(load, '担ぎ手はloadを名乗る').toBeDefined();

    const milliseconds = fastestMilliseconds(200, () => {
      weight!.getEffectiveValue();
      load!.getEffectiveValue();
    });

    expect(milliseconds, `担いだ木${carried}物ぶんの重さの集計（${milliseconds}ms）`).toBeLessThan(2);
  });

  /**
   * 並んでいる札すべてへ、掴んだ物との組み合わせを両向きに問う（`cardOperations.combinationBetween`
   * と同じ引き方）。落とされる側と掴んだ側の両方から、成立するものと断るものを引く。
   */
  function askEveryCard(cards: readonly WorldObject[], dragged: WorldObject, agent: WorldObject): void {
    for (const target of cards) {
      target.combinationsWith(dragged, agent);
      target.refusedCombinationsWith(dragged, agent);
      dragged.combinationsWith(target, agent);
      dragged.refusedCombinationsWith(target, agent);
    }
  }

  /**
   * 掴んだ物との組み合わせを1つ以上返す札の数。**ここに入る札は要件（`conditions`）まで届いている**
   * ——相手として受け入れる宣言を持たない札は、型のタグを照らし合わせたところで候補が空になり、
   * 要件を一度も評価しない。届いたのに断る理由を宣言していない札は数から漏れるので、これは下限。
   */
  function cardsReachingConditions(
    cards: readonly WorldObject[],
    dragged: WorldObject,
    agent: WorldObject,
  ): number {
    return cards.filter(
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
   * **掴むのは、いちばん多くの札と噛み合う物。** 何を掴むかで要件が評価される札の数が変わるので、
   * 並びの先頭のような暗黙の選び方では、噛み合う宣言を1つも持たない物を掴んで**タグの照合だけを
   * 測る**ことになる。掴む物はその場で選び直し、**要件まで届いた札の数を併せて確かめる**——世界の
   * 宣言が変わって届かなくなったら、測っている面が抜けたことが赤で出る。
   *
   * ここが見るのは**問われた側の判定だけ**で、走査を回す画面側の値段ではない。そちらは
   * [issue #2255](https://github.com/gooyyu1/UnmappedIsland/issues/2255) が持つ。
   */
  it('掴んだ瞬間に全札へ問う組み合わせは、貯め込まなくても札の枚数に比例する', () => {
    const game = newGame();
    const cards = pileCards(game, CARDS);
    expect(cards.length, '並べた札').toBe(CARDS);

    const agent = game.player.instance;
    const [{ dragged, reaching }] = cards
      .map((dragged) => ({ dragged, reaching: cardsReachingConditions(cards, dragged, agent) }))
      .sort((a, b) => b.reaching - a.reaching);
    expect(reaching, `要件まで届いた札（掴んだのは'${dragged.def.name}'）`).toBeGreaterThan(40);

    // **問う札は同じままで、周りの枚数だけ倍にする。** 足したぶんまで問うと、足した札が噛み合うかで
    // 時間が動いてしまい、伸びたのが枚数のせいだと言えない。1枚あたりの判定が周りの枚数を見て
    // いなければ、同じ札を問う時間は動かない——動くなら、判定のどこかが並びを走査している。
    const crowded = newGame();
    const crowdedCards = pileCards(crowded, CARDS * 2);
    expect(crowdedCards.length, '倍に並べた札').toBe(CARDS * 2);
    const sameCards = crowdedCards.slice(0, CARDS);
    const crowdedDragged = crowdedCards[cards.indexOf(dragged)];
    const crowdedAgent = crowded.player.instance;

    const milliseconds = fastestEach(
      50,
      () => askEveryCard(cards, dragged, agent),
      () => askEveryCard(sameCards, crowdedDragged, crowdedAgent),
    );

    expect(
      milliseconds.first,
      `'${dragged.def.name}'を掴んだときの${CARDS}枚ぶんの判定（${milliseconds.first}ms）`,
    ).toBeLessThan(4);
    expect(
      milliseconds.second / milliseconds.first,
      `周りを${CARDS * 2}枚にしたときの伸び（${milliseconds.first}ms → ${milliseconds.second}ms）`,
    ).toBeLessThan(1.5);
  });
});
