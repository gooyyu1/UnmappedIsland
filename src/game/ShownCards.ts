import type { WorldObject } from '../domain/runtime/WorldObject';
import type { CardCombination, CardPlace, ObjectCardStack } from './PlayScreenView';
import { samePlace } from './PlayScreenView';

/**
 * 札が出ている場所。ワールドのスロット（CardPlace）に、子ウィンドウが借りた1枚の枠を足したもの
 * ——そこはワールドの場所ではなく、その1枚が今そこに在るというだけ（Windows.md 1.1節）。
 */
export type CardSpot = CardPlace | 'windowCard';

/**
 * 今その枠に居ないインスタンスと、その枠が帰りを待つか。
 *
 * `awaited` は子ウィンドウへ貸した札（Windows.md 1.1節）。帰ってくる場所として枠と識別子が残る。
 * `unplaced` は探索ウィンドウが抱えている発見物（同5.1節）。まだどの枠にも居たことがないので、
 * 帰る場所を空けておく理由が無く、並びにも入らない。
 */
export type AloftCards = ReadonlyMap<number, 'awaited' | 'unplaced'>;

/** ShownCardsが画面の外から読むもの。行動のたびに作り直される値もあるので、すべて呼び出しで受け取る。 */
export interface CardSource {
  /** その場所にワールドが持っている束（持ち出されている札を引く前）。 */
  readonly stacksIn: (place: CardPlace) => readonly (ObjectCardStack | undefined)[];
  /** 子ウィンドウが借りている1枚（借りていなければundefined）。 */
  readonly borrowedCard: () => ObjectCardStack | undefined;
  /** 今その枠に居ないインスタンス。 */
  readonly aloft: () => AloftCards;
  /** 挙げた個体だけを映すカード（PlayScreenView.cardOfObjects）。 */
  readonly cardOfObjects: (objects: readonly WorldObject[], place: CardPlace) => ObjectCardStack;
  /** 重ねたときに成立する組み合わせ（PlayScreenView.combinationOf）。 */
  readonly combinationOf: (dragged: ObjectCardStack, target: ObjectCardStack) => CardCombination | undefined;
}

/**
 * 画面に出ている札の並び。
 *
 * **表示も操作もここが答える並びだけを見る。** 見えている札と、タップ・ドラッグが動かすインスタンスを
 * 別々に数えると、画面に出ていない札を掴んだことにできてしまう（子ウィンドウへ貸した1枚を、手元に
 * 残っている札のつもりで打ち割る）。
 *
 * Phaserを知らない——レーンでも矩形でもなく「場所（CardSpot）とその中の位置」で答えるので、
 * 描画の無いところで確かめられる。
 */
export class ShownCards {
  private readonly source: CardSource;

  constructor(source: CardSource) {
    this.source = source;
  }

  /** そこに並ぶ束。持ち出されている札を差し引いた、画面に出ている姿そのもの。 */
  stacksAt(spot: CardSpot): readonly (ObjectCardStack | undefined)[] {
    if (spot === 'windowCard') return [this.source.borrowedCard()];

    const stacks = this.source.stacksIn(spot);
    const aloft = this.source.aloft();
    if (aloft.size === 0) return stacks;

    return stacks.flatMap<ObjectCardStack | undefined>((stack) =>
      stack === undefined ? [undefined] : this.showing(stack, aloft),
    );
  }

  /**
   * fromのfromIndexの札をtoのtoIndexの札へ重ねたときに成立する組み合わせ（無ければundefined）。
   * 同じ場所を2度引かないのは、**同じ束へ重ねたことを参照の一致で見分ける**ため（combinationOf）。
   */
  combinationAt(
    from: CardSpot,
    fromIndex: number,
    to: CardSpot,
    toIndex: number,
  ): CardCombination | undefined {
    const fromStacks = this.stacksAt(from);
    const dragged = fromStacks[fromIndex];
    const target = (sameSpot(from, to) ? fromStacks : this.stacksAt(to))[toIndex];
    if (dragged === undefined || target === undefined) return undefined;

    return this.source.combinationOf(dragged, target);
  }

  /**
   * その束のうち画面に出ているぶん（1件）。全部が持ち出されていれば、帰りを待つ枠には印だけの束が
   * 残り（薄い印、CardInteraction.md 6.2節）、待たない枠には何も残らない（0件）。
   */
  private showing(stack: ObjectCardStack, aloft: AloftCards): readonly ObjectCardStack[] {
    const rest = stack.objects.filter((object) => !aloft.has(object.instanceId));
    if (rest.length === stack.objects.length) return [stack];

    const awaited = stack.objects.some((object) => aloft.get(object.instanceId) === 'awaited');
    if (rest.length === 0) return awaited ? [stack] : [];

    // 帰りを待つ札があるなら識別子は貸した1個も含めたまま——帰り着いたときに同じ札として繋がる
    // 必要があるため（CardLane.setCells）。動かせるのは残りだけなので、操作は引き直させる。
    const shown = this.source.cardOfObjects(rest, stack.place);
    return [awaited ? { ...shown, identity: stack.identity } : shown];
  }
}

/** 2つの場所が同じか。借りた1枚の枠はワールドの場所ではないので、名前そのもので見分ける。 */
function sameSpot(a: CardSpot, b: CardSpot): boolean {
  if (a === 'windowCard' || b === 'windowCard') return a === b;
  return samePlace(a, b);
}
