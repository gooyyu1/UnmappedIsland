import type { WorldObject } from '../domain/runtime/WorldObject';
import type { CardCombination, CardPlace, CardPlacement, CardPutIn, ObjectCardStack } from './PlayScreenView';
import { samePlace } from './PlayScreenView';
import type { CardContent, CardEdgeDirection } from './ui/Card';

/**
 * 札が出ている場所。ワールドのスロット（CardPlace）に、子ウィンドウが借りた1枚の枠を足したもの
 * ——そこはワールドの場所ではなく、その1枚が今そこに在るというだけ（Windows.md 1.1節）。
 */
export type CardSpot = CardPlace | 'windowCard';

/** ShownCardsが画面の外から読むもの。行動のたびに作り直される値もあるので、すべて呼び出しで受け取る。 */
export interface CardSource {
  /** その場所にワールドが持っている束（持ち出されている札を引く前）。 */
  readonly stacksIn: (place: CardPlace) => readonly (ObjectCardStack | undefined)[];
  /** 挙げた個体だけを映すカード（PlayScreenView.cardOfObjects）。 */
  readonly cardOfObjects: (objects: readonly WorldObject[], place: CardPlace) => ObjectCardStack;
  /** 重ねたときに成立する組み合わせ（PlayScreenView.combinationOf）。 */
  readonly combinationOf: (dragged: ObjectCardStack, target: ObjectCardStack) => CardCombination | undefined;
  /** 子ウィンドウが映しているスロット（映していなければundefined）。端の行き先の候補に入る。 */
  readonly windowPlace: () => CardPlace | undefined;
}

/** ドラッグしたカードを落とした先（CardDropの、レーンを場所に直した形）。 */
export interface ShownDrop {
  readonly from: CardSpot;
  readonly fromIndex: number;
  readonly to: CardSpot;
  /** カードへ重ねた（combine）か、隙間・空き枠へ落とした（CardPlacement）か。 */
  readonly target: { readonly kind: 'combine'; readonly index: number } | CardPlacement;
  /** この操作で動かす枚数（1以上）。束をまとめて運んでいるときだけ2以上になる。 */
  readonly count: number;
}

/**
 * 画面に出ている札の並びと、その上の操作の意味。
 *
 * **表示も操作もここが答える並びだけを見る。** 見えている札と、タップ・ドラッグが動かすインスタンスを
 * 別々に数えると、画面に出ていない札を掴んだことにできてしまう（子ウィンドウへ貸した1枚を、手元に
 * 残っている札のつもりで打ち割る）。
 *
 * **宙に在る札もここが持つ**——子ウィンドウへ貸した札（lend〜landed）と、探索ウィンドウが抱えている
 * 発見物（takeFound〜returnFound）。持ち出しの記録と並びの引き算を別の持ち主に分けると、
 * 片方だけ更新して食い違わせることができてしまう。
 *
 * Phaserを知らない——レーンでも矩形でもなく「場所（CardSpot）とその中の位置」で答えるので、
 * 描画の無いところで確かめられる。矩形（どこへ飛ぶか）と実行の時機は呼び出し側の仕事。
 */
export class ShownCards {
  private readonly source: CardSource;

  /**
   * 子ウィンドウへ貸している札のインスタンス（Windows.md 1.1節）と、そこから元の枠へ帰る途中の札。
   * 帰り着くまで（landed）は元の枠に居ない。
   */
  private readonly lent = new Set<number>();

  /** 今貸している1枚の見た目（返すときの分身の姿になる）。ポートレイトのような束でない札もある。 */
  private lentFace: CardContent | undefined;

  /** 子ウィンドウが映している、借りた1枚の束（カードを出さないウィンドウではundefined）。 */
  private window: ObjectCardStack | undefined;

  /** 探索ウィンドウが抱えている発見物（Windows.md 5.1節）。まだどの枠にも居たことがない。 */
  private foundCards: readonly CardContent[] = [];

  constructor(source: CardSource) {
    this.source = source;
  }

  /** 入り直すときに全部を手放す。前のプレイの世界の札を持ち越さない。 */
  reset(): void {
    this.lent.clear();
    this.lentFace = undefined;
    this.window = undefined;
    this.foundCards = [];
  }

  // ---- 並び ----

  /** そこに並ぶ束。持ち出されている札を差し引いた、画面に出ている姿そのもの。 */
  stacksAt(spot: CardSpot): readonly (ObjectCardStack | undefined)[] {
    if (spot === 'windowCard') return [this.window];

    const stacks = this.source.stacksIn(spot);
    const aloft = this.aloft();
    if (aloft.size === 0) return stacks;

    return stacks.flatMap<ObjectCardStack | undefined>((stack) =>
      stack === undefined ? [undefined] : this.showing(stack, aloft),
    );
  }

  /**
   * 今その枠に居ないインスタンスと、その枠が帰りを待つか。`awaited`は貸した札（帰ってくる場所として
   * 枠と識別子が残る）、`unplaced`は発見物（帰る場所を空けておく理由が無く、並びにも入らない）。
   */
  private aloft(): ReadonlyMap<number, 'awaited' | 'unplaced'> {
    const aloft = new Map<number, 'awaited' | 'unplaced'>();
    for (const id of this.lent) aloft.set(id, 'awaited');
    for (const card of this.foundCards) for (const id of card.identity ?? []) aloft.set(id, 'unplaced');
    return aloft;
  }

  /**
   * その束のうち画面に出ているぶん（1件）。全部が持ち出されていれば、帰りを待つ枠には印だけの束が
   * 残り（薄い印、CardInteraction.md 6.2節）、待たない枠には何も残らない（0件）。
   */
  private showing(
    stack: ObjectCardStack,
    aloft: ReadonlyMap<number, 'awaited' | 'unplaced'>,
  ): readonly ObjectCardStack[] {
    const rest = stack.objects.filter((object) => !aloft.has(object.instanceId));
    if (rest.length === stack.objects.length) return [stack];

    const awaited = stack.objects.some((object) => aloft.get(object.instanceId) === 'awaited');
    if (rest.length === 0) return awaited ? [stack] : [];

    // 帰りを待つ札があるなら識別子は貸した1個も含めたまま——帰り着いたときに同じ札として繋がる
    // 必要があるため（CardLane.setCells）。動かせるのは残りだけなので、操作は引き直させる。
    const shown = this.source.cardOfObjects(rest, stack.place);
    return [awaited ? { ...shown, identity: stack.identity } : shown];
  }

  // ---- 子ウィンドウへの貸し出し（Windows.md 1.1節） ----

  /**
   * その束の先頭の1個を、子ウィンドウへ映す札として取り分ける。束を押しても、ウィンドウへ移るのは
   * 先頭の1枚だけ——ボタンの操作が効くのもその1個なので、残りは元の枠に居たまま掴める。
   * この時点ではまだ貸していない（lend）。前のウィンドウの返却が先に済む必要があるため。
   */
  borrowFirst(stack: ObjectCardStack): ObjectCardStack {
    const first = this.source.cardOfObjects(stack.objects.slice(0, 1), stack.place);
    this.window = first;
    return first;
  }

  /** カードを出さないウィンドウ（装備・怪我・キャラクタ）を開く。映す束は無い。 */
  clearWindowStack(): void {
    this.window = undefined;
  }

  /** 子ウィンドウが今映している束（カードを出さないウィンドウではundefined）。 */
  get windowStack(): ObjectCardStack | undefined {
    return this.window;
  }

  /**
   * その札を貸し出す。返ってくるのは、貸した札のインスタンスと、それが既に宙に在ったか
   * （画面を作り直して開き直した場合。既にそこに在ったものなので、運んで見せてはいけない）。
   * 識別子の無い札は貸せない（undefined）。
   */
  lend(content: CardContent): { readonly id: number; readonly alreadyAloft: boolean } | undefined {
    const id = content.identity?.[0];
    if (id === undefined) return undefined;

    this.lentFace = content;
    const alreadyAloft = this.lent.has(id);
    this.lent.add(id);
    return { id, alreadyAloft };
  }

  /**
   * 貸していた札を返してもらう（貸していなければundefined）。**インスタンスはまだ宙に在る**——
   * 帰りの便が着くか、帰り先が無いと分かった時点でlandedを呼ぶこと。
   */
  retrieve(): { readonly content: CardContent; readonly id: number } | undefined {
    const content = this.lentFace;
    this.lentFace = undefined;

    const id = content?.identity?.[0];
    if (content === undefined || id === undefined) return undefined;
    return { content, id };
  }

  /** 宙に在った1枚が元の枠に帰り着いた（または帰り先が無くその場で消えた）。 */
  landed(id: number): void {
    this.lent.delete(id);
  }

  /**
   * 貸している札のインスタンス（差し替えの計画が枚数から引く、MotionContext.borrowed）。
   * **生きた集合そのもの**——差し替えの初めに帰り着く札はその場で解ける（landed）ので、
   * 控えを渡すと解けたはずの1枚を引き続き数えてしまう。
   */
  get lentIds(): ReadonlySet<number> {
    return this.lent;
  }

  /**
   * 貸している1枚を今のワールドで引き直す（世界から消えていればundefined）。**束ではなくその1個**
   * ——ウィンドウが映しているのも、ボタンの操作が効くのもその1個だけ。引き直せたら、映す束も
   * 返すときの姿もその新しい札になる。
   */
  restackWindow(): ObjectCardStack | undefined {
    const opened = this.window;
    const id = opened?.identity?.[0];
    if (opened === undefined || id === undefined) return undefined;

    for (const stack of this.source.stacksIn(opened.place)) {
      const object = stack?.objects.find((entry) => entry.instanceId === id);
      if (stack !== undefined && object !== undefined) {
        const card = this.source.cardOfObjects([object], stack.place);
        this.window = card;
        this.lentFace = card;
        return card;
      }
    }
    return undefined;
  }

  // ---- 探索の発見物（Windows.md 5.1節） ----

  /** 探索で見つかったものを、探索ウィンドウが抱える。抱えている間、その札はどの枠にも並ばない。 */
  takeFound(cards: readonly CardContent[]): void {
    this.foundCards = cards;
  }

  /** 抱えている発見物。 */
  get found(): readonly CardContent[] {
    return this.foundCards;
  }

  /** 発見物を全部手放す。手放した札は次の差し替えから本来の枠に並ぶ。 */
  returnFound(): readonly CardContent[] {
    const found = this.foundCards;
    this.foundCards = [];
    return found;
  }

  // ---- 操作の意味 ----

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

  /** そのドロップが重ねる操作なら、成立する組み合わせ。 */
  dropCombination(drop: ShownDrop): CardCombination | undefined {
    if (drop.target.kind !== 'combine') return undefined;
    return this.combinationAt(drop.from, drop.fromIndex, drop.to, drop.target.index);
  }

  /**
   * ドロップで起きること（何も起きないならundefined）。カードに重ねたらcombination、相手が入れ物なら
   * その中へ入れる、隙間・空き枠へ落としたら位置を変える。同じ場所の中ならスタックごとの並び替え、
   * 場所をまたぐならカード1枚の移動。
   */
  dropAction(drop: ShownDrop): (() => void) | undefined {
    if (drop.target.kind === 'combine') return this.dropCombination(drop)?.execute ?? this.putInto(drop);
    // 借りた札の枠はワールドの場所ではないので、そこへ「入れる」ことはできない（重ねるだけ）。
    if (drop.to === 'windowCard') return undefined;

    const dragged = this.stacksAt(drop.from)[drop.fromIndex];
    if (dragged === undefined) return undefined;
    return sameSpot(drop.from, drop.to)
      ? dragged.reorder?.(drop.target)
      : dragged.moveTo?.(drop.to, drop.target, drop.count);
  }

  /**
   * そのドロップでまとめて動かせる最大枚数（1ならついてこない）。**combinationは常に1**——
   * 条件は世界のどこでも見られ、1回実行するたびに世界が変わるので、2回目が成立するかは
   * やってみるまで分からない。ついてきた枚数を約束にできるのは、枠が空きを答えられる「入れる」だけ。
   */
  multiDropLimit(drop: ShownDrop): number {
    if (this.dropCombination(drop) !== undefined) return 1;

    const dragged = this.stacksAt(drop.from)[drop.fromIndex];
    if (dragged === undefined) return 1;
    if (drop.target.kind === 'combine') {
      const into = this.contentsUnder(drop);
      return into === undefined ? 1 : (dragged.acceptedCountAt?.(into) ?? 1);
    }
    // 同じ場所の中は並び替えで、束ごと動く（SlotSystem.md 3節）。
    if (sameSpot(drop.from, drop.to) || drop.to === 'windowCard') return 1;
    return dragged.acceptedCountAt?.(drop.to) ?? 1;
  }

  /**
   * そのドロップで起きることの見せ方（文言も時間も宣言されていなければundefined）。combinationと、
   * 文言や時間を宣言している枠へ入れる操作（手当てなど）が名前・説明・かかる時間を持つ。
   */
  dropEffect(drop: ShownDrop): CardCombination | CardPutIn | undefined {
    return this.dropCombination(drop) ?? this.putInAt(drop);
  }

  /**
   * そのドロップで手から放したもの（MotionContext.released。矩形を添えるのは呼び出し側）。
   * どの個体が動くのかはビューが答える（movedIds）。重ねて実行するcombinationに加わるのは
   * 掴んでいた1つだけで、それは束の代表とは限らない（CardCombination.held参照）。
   */
  movedBy(drop: ShownDrop): { readonly grabbed: number; readonly followers: readonly number[] } | undefined {
    const combination = this.dropCombination(drop);
    if (combination !== undefined) {
      return { grabbed: combination.held.instanceId, followers: [] };
    }

    const [grabbed, ...followers] = this.stacksAt(drop.from)[drop.fromIndex]?.movedIds(drop.count) ?? [];
    return grabbed === undefined ? undefined : { grabbed, followers };
  }

  /**
   * カードに重ねたときに、そのカードの中へ入れる操作（入れ物でない・入らないならundefined）。
   *
   * かごも製作中オブジェクトも同じ扱い——「押すと中身が並ぶカード」（main_item_slot）の上へ落としたら、
   * そのスロットへ入る。入るかどうかは枠の宣言（accept・max）が決めるので、ここでは場所を指すだけ。
   */
  private putInto(drop: ShownDrop): (() => void) | undefined {
    const into = this.contentsUnder(drop);
    return into === undefined
      ? undefined
      : this.stacksAt(drop.from)[drop.fromIndex]?.moveTo?.(into, undefined, drop.count);
  }

  /** カードに重ねたとき、そのカードが中身を映す場所（入れ物でなければundefined）。 */
  private contentsUnder(drop: ShownDrop): CardPlace | undefined {
    if (drop.target.kind !== 'combine') return undefined;

    const dragged = this.stacksAt(drop.from)[drop.fromIndex];
    const target = this.stacksAt(drop.to)[drop.target.index];
    // 自分自身の中へは入れられない（1枚しか映していないカードを、そのカードへ重ねた場合）。
    return dragged === undefined || dragged === target ? undefined : target?.contents;
  }

  /** そのドロップが「入れる」なら、その見せ方（枠が文言も時間も宣言していなければundefined）。 */
  private putInAt(drop: ShownDrop): CardPutIn | undefined {
    const dragged = this.stacksAt(drop.from)[drop.fromIndex];
    if (dragged === undefined) return undefined;

    if (drop.target.kind === 'combine') {
      const into = this.contentsUnder(drop);
      return into === undefined ? undefined : dragged.putInto?.(into, drop.count);
    }
    // 枠・隙間へ落とすのも同じ「入れる」。同じ場所の中は並び替えなので値段は付かない。
    if (sameSpot(drop.from, drop.to) || drop.to === 'windowCard') return undefined;
    return dragged.putInto?.(drop.to, drop.count);
  }

  // ---- カードの端の移動 ----

  /** 端を押したときの移動（その向きへ移せないならundefined）。行き先は「空いている場所」なので位置は指定しない。 */
  edgeMove(card: ObjectCardStack, direction: CardEdgeDirection): (() => void) | undefined {
    for (const place of this.edgeTargets(card.place, direction)) {
      const move = card.moveTo?.(place);
      if (move !== undefined) return move;
    }
    return undefined;
  }

  /**
   * その向きの行き先の候補を、近い順に。フィールドの並びの上下関係（設置物→アイテム→手持ち）
   * そのままで、子ウィンドウのカードの下は手持ち。
   *
   * 手持ちの上は、子ウィンドウを開いている間だけそちらを先に見る——カードをやり取りする相手が
   * 画面に出ているなら、端を押す操作もその相手を指すのが自然なため。受け取れない相手（怪我）なら
   * 元どおりアイテムへ落ちる。開いているだけで手持ちの端が使えなくなるのは不便なため。
   */
  edgeTargets(from: CardPlace, direction: CardEdgeDirection): readonly CardPlace[] {
    if (direction === 'up') {
      if (from === 'items') return ['fixtures'];
      if (from !== 'hand') return [];
      const window = this.source.windowPlace();
      return window === undefined ? ['items'] : [window, 'items'];
    }
    if (from === 'fixtures') return ['items'];
    if (from === 'items') return ['hand'];
    // 手持ちの下は無く、子ウィンドウのカード（装備・怪我・コンテナの中身）の下は手持ち。
    return from === 'hand' ? [] : ['hand'];
  }
}

/** 2つの場所が同じか。借りた1枚の枠はワールドの場所ではないので、名前そのもので見分ける。 */
export function sameSpot(a: CardSpot, b: CardSpot): boolean {
  if (a === 'windowCard' || b === 'windowCard') return a === b;
  return samePlace(a, b);
}
