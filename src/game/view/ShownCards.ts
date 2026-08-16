import type { WorldObject } from '../../domain/runtime/WorldObject';
import type { CardCombination, CardPlace, CardPlacement, CardPutIn, ObjectCardStack } from './PlayScreenView';
import { samePlace } from './PlayScreenView';
import type { CardContent, CardEdgeDirection } from '../ui/Card';
import { cardFace } from '../ui/cardFace';

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
 * **枠の外に出ている札もここが持つ**——子ウィンドウが映している1枚（borrow〜returnBorrowed）と、
 * 探索ウィンドウが抱えている発見物（takeFound〜returnFound）。どこに出ているかの記録と並びの引き算を
 * 別の持ち主に分けると、片方だけ更新して食い違わせることができてしまう。
 *
 * Phaserを知らない——レーンでも矩形でもなく「場所（CardSpot）とその中の位置」で答えるので、
 * 描画の無いところで確かめられる。矩形（どこへ飛ぶか）と実行の時機は呼び出し側の仕事。
 */
export class ShownCards {
  private readonly source: CardSource;

  /**
   * 子ウィンドウが今出している1枚（Windows.md 1.1節）。**借りているという事実はこれだけ**
   * ——ウィンドウがその札を出しているなら、元の枠には出ていない。運んでいる途中かどうかは
   * 画面の側の話で、ここには持ち込まない。
   *
   * 束から借りたならその束も持つ。ポートレイト（キャラクタ自身の札）のように束でない札もあり、
   * そちらは映すだけでボタンの相手にはならない。
   */
  private window: { readonly card: CardContent; readonly stack: ObjectCardStack | undefined } | undefined;

  /** 探索ウィンドウが抱えている発見物（Windows.md 5.1節）。まだどの枠にも居たことがない。 */
  private foundCards: readonly CardContent[] = [];

  constructor(source: CardSource) {
    this.source = source;
  }

  /** 入り直すときに全部を手放す。前のプレイの世界の札を持ち越さない。 */
  reset(): void {
    this.window = undefined;
    this.foundCards = [];
  }

  // ---- 並び ----

  /** そこに並ぶ束。持ち出されている札を差し引いた、画面に出ている姿そのもの。 */
  stacksAt(spot: CardSpot): readonly (ObjectCardStack | undefined)[] {
    if (spot === 'windowCard') return [this.window?.stack];

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
    for (const id of this.window?.card.identity ?? []) aloft.set(id, 'awaited');
    for (const card of this.foundCards) for (const id of card.identity ?? []) aloft.set(id, 'unplaced');
    return aloft;
  }

  /**
   * その束のうち画面に出ているぶん（1件）。全部が持ち出されていれば、帰りを待つ枠には印だけが残り
   * （薄い印、CardInteraction.md 6.2節）、待たない枠には何も残らない（0件）。
   *
   * **出ている個体だけを名乗る**（identity）。よそに出ているぶんはawaitedとして枠が待つので、
   * 同じ個体の札が画面に2枚出ることはなく、掴める札・重ねられる札もここに在るものだけになる。
   */
  private showing(
    stack: ObjectCardStack,
    aloft: ReadonlyMap<number, 'awaited' | 'unplaced'>,
  ): readonly ObjectCardStack[] {
    const rest = stack.objects.filter((object) => !aloft.has(object.instanceId));
    if (rest.length === stack.objects.length) return [stack];

    const awaited = stack.objects
      .filter((object) => aloft.get(object.instanceId) === 'awaited')
      .map((object) => object.instanceId);
    if (rest.length === 0) return awaited.length === 0 ? [] : [awaitingStack(stack, awaited)];

    const shown = this.source.cardOfObjects(rest, stack.place);
    return [awaited.length === 0 ? shown : { ...shown, awaited }];
  }

  // ---- 子ウィンドウへの貸し出し（Windows.md 1.1節） ----

  /**
   * その束のうち、子ウィンドウが映すことになる先頭の1個ぶんの札（まだ借りていない）。束を押しても、
   * ウィンドウへ移るのは先頭の1枚だけ——ボタンの操作が効くのもその1個なので、残りは元の枠に
   * 居たまま掴める。
   */
  firstOf(stack: ObjectCardStack): ObjectCardStack {
    return this.source.cardOfObjects(stack.objects.slice(0, 1), stack.place);
  }

  /**
   * その1枚を、子ウィンドウが出す札として借りる。この時点から、それは元の枠ではなくウィンドウの枠に
   * 出ている——枠から枠への運びは、並びの差し替えがそのまま見せる（cardMotionPlan）。
   *
   * **札を出さないウィンドウでは借りない**（装備・怪我）。借りると、元の枠から消えたままどこにも
   * 出ない札ができてしまう。
   */
  borrow(card: CardContent, stack: ObjectCardStack | undefined): void {
    this.window = { card, stack };
  }

  /**
   * 借りていた札を手放す。返ってくるのは手放したインスタンス。**次の差し替えから元の枠に並ぶ**ので、
   * 呼び出し側はウィンドウの枠を出どころとして渡すだけでよい（MotionContext.origins）。
   */
  returnBorrowed(): readonly number[] {
    const released = this.window?.card.identity ?? [];
    this.window = undefined;
    return released;
  }

  /** 子ウィンドウが今出している1枚（出していなければundefined）。 */
  get windowCard(): CardContent | undefined {
    return this.window?.card;
  }

  /** 子ウィンドウが今映している束（束でない札を出しているウィンドウではundefined）。 */
  get windowStack(): ObjectCardStack | undefined {
    return this.window?.stack;
  }

  /**
   * その札から、子ウィンドウが借りているぶんを引いた姿（束を持たない札——ポートレイト——のためのもの。
   * 束の並びはstacksAtが同じ引き算をする）。1個も残らなければ、帰りを待つ印になる。
   */
  shownCard(card: CardContent): CardContent {
    const borrowed = new Set(this.window?.card.identity ?? []);
    const ids = card.identity ?? [];
    const awaited = ids.filter((id) => borrowed.has(id));
    if (awaited.length === 0) return card;

    const rest = ids.filter((id) => !borrowed.has(id));
    return rest.length === 0 ? awaitingMark(card, awaited) : { ...card, identity: rest, awaited };
  }

  /**
   * 貸している1枚を今のワールドで引き直す（世界から消えていればundefined）。**束ではなくその1個**
   * ——ウィンドウが映しているのも、ボタンの操作が効くのもその1個だけ。引き直せたら、映す束も
   * 返すときの姿もその新しい札になる。
   */
  restackWindow(): ObjectCardStack | undefined {
    const opened = this.window?.stack;
    const id = opened?.identity?.[0];
    if (opened === undefined || id === undefined) return undefined;

    for (const stack of this.source.stacksIn(opened.place)) {
      const object = stack?.objects.find((entry) => entry.instanceId === id);
      if (stack !== undefined && object !== undefined) {
        const card = this.source.cardOfObjects([object], stack.place);
        this.window = { card, stack: card };
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
    // 個体を1つも出していない札（帰りを待つ印）は、掴む相手にも重ねる相手にもならない。
    if (dragged.objects.length === 0 || target.objects.length === 0) return undefined;

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

/**
 * 帰りを待つ印（CardInteraction.md 6.2節）。個体を1つも出していないので、**顔だけを持ち操作は
 * 何も持たない**——掴めないだけでなく、重ねる相手にも入れ物にもならない。そこに在るのは札ではなく、
 * 借りた1枚が帰ってくる場所の目印だから。
 */
function awaitingMark(card: CardContent, awaited: readonly number[]): CardContent {
  // 個体を映す札ではあるが、今そこに在るのは0個（識別子を持たない札＝個体を映さない札とは別物）。
  return { ...cardFace(card), identity: [], awaited };
}

/** 束の枠に残る印。操作を持たないだけでなく、個体を1つも出していない（掴めず、重ねる相手にもならない）。 */
function awaitingStack(stack: ObjectCardStack, awaited: readonly number[]): ObjectCardStack {
  return {
    ...awaitingMark(stack, awaited),
    objects: [],
    actions: [],
    place: stack.place,
    objectGlobalId: stack.objectGlobalId,
    movedIds: () => [],
  };
}

/** 2つの場所が同じか。借りた1枚の枠はワールドの場所ではないので、名前そのもので見分ける。 */
export function sameSpot(a: CardSpot, b: CardSpot): boolean {
  if (a === 'windowCard' || b === 'windowCard') return a === b;
  return samePlace(a, b);
}
