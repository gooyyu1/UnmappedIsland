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
 * **どちらも規模に頭打ちが無い。**
 *
 * - **担いだ木の物の数に頭打ちは無い。** 枠（`cell_count`）とかさ（`capacity`）が決めるのは物の数では
 *   なく、**詰める物1個のかさとの割り算**なので、かさの小さい物で埋めればいくらでも増える。
 * - **並ぶ札の枚数にも頭打ちは無い。** 束ねない型（`stackable: false`）は個体ごとに1枚の札になるので、
 *   同じ型を並べればいくらでも増える。
 *
 * だから「この規模で収まった」だけでは足りない。**規模を決め打ちした状態で値に上限を引き**、札のほうは
 * さらに**周りの枚数を倍にしても1枚あたりが動かないこと**を見る。後者は伸び方への上限なので、機械の
 * 速さにも将来の宣言の数にも左右されない。
 *
 * **担いだ木の側に伸び方の上限は置いていない。** この木は浅くて広い（入れ物の下に物が並ぶ）ため、
 * 1物あたりの値段が木の大きさに連れて増える壊れ方を作れず、**落ちるものを置けなかった**。置いたのは
 * 1物あたりを縛る値の上限だけで、伸び方は測った値の並びが示すスナップショット。
 *
 * **値への上限は1フレーム（16ms）では引かない。** 今の値との開きが大きすぎて、伸び方が変わっても
 * 緑のまま通る。引くのは**桁の変わった遅さが落ちる幅**で、実際に導出を100倍に重くして赤くなることを
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

  /** 並べる札の枚数（倍にした側も組んで、1枚あたりが動かないことを見る）。 */
  const CARDS = 150;

  /** 担いだ木にぶら下げる物の数。1物あたりの値段を、この規模で縛る。 */
  const CARRIED = 8000;

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
   * 担ぎ手に物を`wanted`個ぶら下げ、その数を返す。手に籠を持たせ、かさのいちばん小さい物
   * （`bone_needle`）で埋めて、埋まったら次の籠を持つ。
   *
   * **かさの小さい物で埋めるのは、物の数に頭打ちが無いことを使うため。** 枠（`cell_count`）と
   * かさ（`capacity`）が決めるのは物の数ではなく**詰める物1個のかさとの割り算**なので、大きい物で
   * 埋めた数は上限ではない——籠1つ（`capacity: 20000`）に骨針（`volume: 5`）なら4000個入る。
   */
  function carryObjects(game: StartedGame, wanted: number): number {
    const contentsSlotId = codex.slotNames.getId('contents');
    let basket = create(game, 'woven_basket');
    expect(game.player.take(basket), '籠を手に持てる').toBe(true);
    let carried = 1;

    while (carried < wanted) {
      const needle = create(game, 'bone_needle');
      if (needle.moveToSlotOrRejection(basket.getSlot(contentsSlotId)) === undefined) {
        carried++;
        continue;
      }
      basket = create(game, 'woven_basket');
      expect(game.player.take(basket), `${wanted}個ぶら下げるには手の枠が足りる`).toBe(true);
      carried++;
    }
    return carried;
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
  /** 担ぎ手の `weight` と `load` の実効値を1回ずつ読む（読むたびに担いだ木を辿り直す）。 */
  function readWeightAndLoad(game: StartedGame): () => void {
    const player = game.player.instance;
    const weight = player.tryGetProperty(codex.vocabulary.engine.weightId);
    const load = player.tryGetProperty(codex.vocabulary.engine.loadId);
    expect(weight, '担ぎ手はweightを名乗る').toBeDefined();
    expect(load, '担ぎ手はloadを名乗る').toBeDefined();

    return () => {
      weight!.getEffectiveValue();
      load!.getEffectiveValue();
    };
  }

  it('担いだ荷を辿って重さを出すのは、貯め込まなくても1物あたりが小さい', () => {
    const game = newGame();
    expect(carryObjects(game, CARRIED), 'ぶら下げた物').toBe(CARRIED);

    const milliseconds = fastestMilliseconds(200, readWeightAndLoad(game));

    expect(milliseconds, `担いだ木${CARRIED}物ぶんの重さの集計（${milliseconds}ms）`).toBeLessThan(4);
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
