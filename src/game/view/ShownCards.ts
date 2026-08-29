import type { CardFilter } from '../../domain/CardFilter';
import type { WorldObject } from '../../domain/WorldObject';
import type { ObjectCardStack } from './PlayScreenView';
import type { CardCombination, CardDrop } from './cardOperations';
import type { CardPlace, CardPlacement, ScreenPlaceResolver } from './cardPlaces';
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
  readonly cardOfObjects: (objects: readonly WorldObject[]) => ObjectCardStack;
  /** 重ねたときに成立する組み合わせ（PlayScreenView.combinationOf）。countはまとめて実行する個数。 */
  readonly combinationOf: (
    dragged: ObjectCardStack,
    target: ObjectCardStack,
    count?: number,
  ) => CardCombination | undefined;
  /** その物が現在地から見えるか（PlayScreenView.visible）。見えない物は画面のどこにも出さない。 */
  readonly visible: (object: WorldObject) => boolean;
  /**
   * 今選ばれている絞り込み（何も選んでいなければundefined、ScreenLayout.md 8.1節）。**選ぶのは
   * プレイヤーで、世界の状態ではない**ので、行動のたびではなくボタンを押したときだけ変わる。
   */
  readonly filter: () => CardFilter | undefined;
  /** 子ウィンドウが映しているスロット（映していなければundefined）。端の行き先の候補に入る。 */
  readonly windowPlace: () => CardPlace | undefined;
  /**
   * 画面の区画が**今映している**スロット。端の行き先はレーンの並びで決まるので、設置物レーンが
   * 外側の場所を映していれば、上へ送る先もその外側になる（ScreenLayout.md 7.1.1節）。
   */
  readonly places: ScreenPlaceResolver;
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
 * **枠の外に出ている札もここが持つ**——子ウィンドウが映している1枚（borrow）と、探索で見つかって
 * 子ウィンドウの発見物の枠に居るもの（takeFound）。**どちらも借りているのは子ウィンドウ**なので、
 * 窓が消えるときは1回で全部返る（returnBorrowed）。どこに出ているかの記録と並びの引き算を
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
   * そちらは映すだけでボタンの相手にはならない。**subjectは束の有無によらず在る**ので、
   * 窓を畳むかの判定（reborrowedWindow）は札を借りない窓にも同じ形で効く。
   */
  private window:
    | {
        readonly subject: WorldObject;
        readonly card: CardContent;
        readonly stack: ObjectCardStack | undefined;
      }
    | undefined;

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

  /** そこに並ぶ束。持ち出されている札と絞り込みで隠れる札を差し引いた、画面に出ている姿そのもの。 */
  stacksAt(spot: CardSpot): readonly (ObjectCardStack | undefined)[] {
    if (spot === 'windowCard') return [this.window?.stack];

    const stacks = this.source.stacksIn(spot);
    const aloft = this.aloft();
    const shown =
      aloft.size === 0
        ? stacks
        : stacks.flatMap<ObjectCardStack | undefined>((stack) =>
            stack === undefined ? [undefined] : this.shownStacksOf(stack, aloft),
          );
    return this.matching(spot, shown);
  }

  /**
   * 絞り込みに当たる札だけ（何も選んでいない場所・レーンではそのまま）。**効くのは設置物レーンと
   * アイテムレーンだけ**（ScreenLayout.md 8.1.6節）——手持ちは左へ詰まっていて隠しても短くならず、
   * 子ウィンドウの中は今開けている入れ物そのものの中身なので、絞ると開けた意味が消える。
   *
   * **出ている個体が1つも当たらない札は隠れる。** 貸し出し中の枠に残る印（objectsが空）も同じで、
   * 帰ってくる先はその札が当たるようになったときに現れる。
   */
  private matching(
    spot: CardSpot,
    stacks: readonly (ObjectCardStack | undefined)[],
  ): readonly (ObjectCardStack | undefined)[] {
    const filter = this.source.filter();
    if (filter === undefined) return stacks;

    const places = this.source.places;
    if (spot !== places('fixtures') && spot !== places('items')) return stacks;

    return stacks.filter(
      (stack) => stack === undefined || stack.objects.some((object) => filter.matches(object)),
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
  private shownStacksOf(
    stack: ObjectCardStack,
    aloft: ReadonlyMap<number, 'awaited' | 'unplaced'>,
  ): readonly ObjectCardStack[] {
    const rest = stack.objects.filter((object) => !aloft.has(object.instanceId));
    if (rest.length === stack.objects.length) return [stack];

    const awaited = stack.objects
      .filter((object) => aloft.get(object.instanceId) === 'awaited')
      .map((object) => object.instanceId);
    if (rest.length === 0) return awaited.length === 0 ? [] : [stackWithAwaitingMark(stack, awaited)];

    const shown = this.source.cardOfObjects(rest);
    return [awaited.length === 0 ? shown : { ...shown, awaited }];
  }

  // ---- 子ウィンドウへの貸し出し（Windows.md 1.1節） ----

  /**
   * その束のうち、子ウィンドウが映すことになる先頭の1個ぶんの札（まだ借りていない）。束を押しても、
   * ウィンドウへ移るのは先頭の1枚だけ——ボタンの操作が効くのもその1個なので、残りは元の枠に
   * 居たまま掴める。
   */
  firstOf(stack: ObjectCardStack): ObjectCardStack {
    return this.source.cardOfObjects(stack.objects.slice(0, 1));
  }

  /**
   * その1枚を、子ウィンドウが出す札として借りる。この時点から、それは元の枠ではなくウィンドウの枠に
   * 出ている——枠から枠への運びは、並びの差し替えがそのまま見せる（cardMotionPlan）。
   *
   * subjectは窓が映している1個（ObjectWindowView.object）。**stackを渡さないウィンドウでも要る**
   * ——場所やキャラクタの窓も、映しているものが見えなくなれば畳むため（reborrowedWindow）。
   *
   * **札を出さないウィンドウでは束を渡さない**（装備・怪我）。渡すと、元の枠から消えたままどこにも
   * 出ない札ができてしまう。
   */
  borrow(subject: WorldObject, card: CardContent, stack: ObjectCardStack | undefined): void {
    this.window = { subject, card, stack };
  }

  /**
   * **子ウィンドウが借りていたものを全部手放す**（映している1枚と、抱えている発見物）。窓が消えれば
   * どちらも出る場所を失うので、片方だけ返すことはない——分けて持つと、閉じる道筋が増えたときに
   * 片方を呼び忘れる（実際に発見物がレーンへ帰らなくなっていた）。
   *
   * 返ってくるのは手放したもの。**次の差し替えから元の枠に並ぶ**ので、呼び出し側は出どころ
   * （それぞれが今居る枠）を渡すだけでよい（MotionContext.origins）。
   */
  returnBorrowed(): { readonly card: readonly number[]; readonly found: readonly CardContent[] } {
    const card = this.window?.card.identity ?? [];
    this.window = undefined;
    return { card, found: this.returnFound() };
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
    return rest.length === 0 ? cardWithAwaitingMark(card, awaited) : { ...card, identity: rest, awaited };
  }

  /**
   * 子ウィンドウが映しているものを今のワールドで借り直し、**まだ映せるか**を答える（映せなければ
   * ウィンドウを閉じる合図）。
   *
   * **映せなくなるのは、映している1個が現在地から見えなくなったとき**——食べた・打ち割った物も、
   * 別の土地へ移って置いてきた物も、同じ1つの基準で落ちる（CardSource.visible）。世界に在るかどうかは
   * 見ない。道は移った先から見えないだけで世界には在り続けるため。
   *
   * 借りている束は今のワールドで引き直す。差し替えの前後で束は別物になっているので、そのまま使うと
   * 次のアクションが古いインスタンスに対して組まれる。
   */
  reborrowedWindow(): boolean {
    const opened = this.window;
    if (opened === undefined) return true;
    if (!this.source.visible(opened.subject)) return false;

    // 札を借りていない窓（場所・キャラクタ・装備・怪我）は、引き直す束が無い。
    return opened.stack === undefined || this.reborrowedCard() !== undefined;
  }

  /**
   * 貸している1枚を今のワールドで引き直す（引き直せなければundefined）。**束ではなくその1個**
   * ——ウィンドウが映しているのも、ボタンの操作が効くのもその1個だけ。引き直せたら、映す束も
   * 返すときの姿もその新しい札になる。
   */
  private reborrowedCard(): ObjectCardStack | undefined {
    const opened = this.window?.stack;
    const id = opened?.identity?.[0];
    if (opened === undefined || id === undefined) return undefined;

    for (const stack of this.source.stacksIn(opened.place)) {
      const object = stack?.objects.find((entry) => entry.instanceId === id);
      if (object === undefined) continue;

      const card = this.source.cardOfObjects([object]);
      this.window = { subject: object, card, stack: card };
      return card;
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

  /**
   * 発見物だけを手放す（次の探索を始めるとき、Windows.md 5.1節）。**窓が消えるときはこちらではなく
   * returnBorrowedを呼ぶ**——借りているものを1つずつ数える必要が無いように。
   */
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
    count = 1,
  ): CardCombination | undefined {
    const fromStacks = this.stacksAt(from);
    const dragged = fromStacks[fromIndex];
    const target = (from === to ? fromStacks : this.stacksAt(to))[toIndex];
    if (dragged === undefined || target === undefined) return undefined;
    // 個体を1つも出していない札（帰りを待つ印）は、掴む相手にも重ねる相手にもならない。
    if (dragged.objects.length === 0 || target.objects.length === 0) return undefined;

    return this.source.combinationOf(dragged, target, count);
  }

  /** そのドロップが重ねる操作なら、成立する組み合わせ。 */
  dropCombination(drop: ShownDrop): CardCombination | undefined {
    if (drop.target.kind !== 'combine') return undefined;
    return this.combinationAt(drop.from, drop.fromIndex, drop.to, drop.target.index, drop.count);
  }

  /**
   * そのドロップで起きること（何も起きないならundefined）。カードに重ねたらcombination、相手が入れ物なら
   * その中へ入れる、隙間・空き枠へ落としたら位置を変える。同じ場所の中ならスタックごとの並び替え、
   * 場所をまたぐならカード1枚の移動。
   *
   * **どれも同じ1つの形（CardDrop）で返る。** 画面は「重ねた」と「入れた」を区別せず、名前と時間を
   * 吹き出しに出して実行するだけ（CardInteraction.md 2節）。
   */
  dropEffect(drop: ShownDrop): CardDrop | undefined {
    const dragged = this.stacksAt(drop.from)[drop.fromIndex];
    if (dragged === undefined) return undefined;

    if (drop.target.kind === 'combine') {
      const combination = this.dropCombination(drop);
      if (combination !== undefined) return combination;

      const into = this.contentsUnder(drop);
      return into === undefined ? undefined : dragged.dropInto?.(into, undefined, drop.count);
    }

    // 借りた札の枠はワールドの場所ではないので、そこへ「入れる」ことはできない（重ねるだけ）。
    if (drop.to === 'windowCard') return undefined;

    // 同じ場所の中は並び替え。位置が変わるだけなので、名乗るものも値段も無い。
    if (drop.from === drop.to) {
      const execute = dragged.reorderActionAt?.(drop.target);
      return execute === undefined
        ? undefined
        : {
            name: undefined,
            description: undefined,
            minutes: 0,
            maxCount: 1,
            movedIds: dragged.movedIds(drop.count),
            execute,
          };
    }
    return dragged.dropInto?.(drop.to, drop.target, drop.count);
  }

  /**
   * そのドロップでまとめて動かせる最大枚数（1ならついてこない）。**combinationは常に1**——
   * 条件は世界のどこでも見られ、1回実行するたびに世界が変わるので、2回目が成立するかは
   * やってみるまで分からない。ついてきた枚数を約束にできるのは、枠が空きを答えられる「入れる」だけ。
   */
  multiDropLimit(drop: ShownDrop): number {
    return this.dropEffect({ ...drop, count: 1 })?.maxCount ?? 1;
  }

  /**
   * そのドロップで手から放したもの（MotionContext.released。矩形を添えるのは呼び出し側）。
   * どの個体が動くのかは、起きることの側が答える（CardDrop.movedIds）——ワールドが動かすものと
   * 画面が飛ばすものを食い違わせないため。
   */
  releasedBy(
    drop: ShownDrop,
  ): { readonly grabbed: number; readonly followers: readonly number[] } | undefined {
    const moved = this.dropEffect(drop)?.movedIds ?? [];
    const grabbed = moved.at(0);
    return grabbed === undefined ? undefined : { grabbed, followers: moved.slice(1) };
  }

  /** カードに重ねたとき、そのカードが中身を映す場所（入れ物でなければundefined）。 */
  private contentsUnder(drop: ShownDrop): CardPlace | undefined {
    if (drop.target.kind !== 'combine') return undefined;

    const dragged = this.stacksAt(drop.from)[drop.fromIndex];
    const target = this.stacksAt(drop.to)[drop.target.index];
    // 自分自身の中へは入れられない（1枚しか映していないカードを、そのカードへ重ねた場合）。
    return dragged === undefined || dragged === target ? undefined : target?.contentsFor(dragged);
  }

  // ---- カードの端の移動 ----

  /** 端を押したときの移動（その向きへ移せないならundefined）。行き先は「空いている場所」なので位置は指定しない。 */
  edgeMoveAction(card: ObjectCardStack, direction: CardEdgeDirection): (() => void) | undefined {
    for (const place of this.edgeTargets(card.place, direction)) {
      const dropped = card.dropInto?.(place);
      if (dropped !== undefined) return dropped.execute;
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
    const places = this.source.places;
    const [fixtures, items, hand] = [places('fixtures'), places('items'), places('hand')];
    if (direction === 'up') {
      if (from === items) return [fixtures];
      if (from !== hand) return [];
      const window = this.source.windowPlace();
      return window === undefined ? [items] : [window, items];
    }
    if (from === fixtures) return [items];
    if (from === items) return [hand];
    // 手持ちの下は無く、子ウィンドウのカード（装備・怪我・コンテナの中身）の下は手持ち。
    return from === hand ? [] : [hand];
  }
}

/**
 * 帰りを待つ印（CardInteraction.md 6.2節）。個体を1つも出していないので、**顔だけを持ち操作は
 * 何も持たない**——掴めないだけでなく、重ねる相手にも入れ物にもならない。そこに在るのは札ではなく、
 * 借りた1枚が帰ってくる場所の目印だから。
 */
function cardWithAwaitingMark(card: CardContent, awaited: readonly number[]): CardContent {
  // 個体を映す札ではあるが、今そこに在るのは0個（識別子を持たない札＝個体を映さない札とは別物）。
  return { ...cardFace(card), identity: [], awaited };
}

/** 束の枠に残る印。操作を持たないだけでなく、個体を1つも出していない（掴めず、重ねる相手にもならない）。 */
function stackWithAwaitingMark(stack: ObjectCardStack, awaited: readonly number[]): ObjectCardStack {
  return {
    ...cardWithAwaitingMark(stack, awaited),
    objects: [],
    actions: [],
    visibleSlots: [],
    contentsFor: () => undefined,
    place: stack.place,
    objectGlobalId: stack.objectGlobalId,
    movedIds: () => [],
  };
}
