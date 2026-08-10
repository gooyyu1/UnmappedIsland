import type { Rect } from '../layout/ScreenMetrics';

/**
 * レーンの差し替えを「どの札がどこからどこへ飛ぶか」に翻訳する計画（ScreenLayout.md カードの
 * 移動アニメーション節）。実行はCardMotionが行い、ここは何も表示しない純粋な計算だけ。
 *
 * **1つのインスタンスの移動は1回だけ見せる**。計画は差し替え後のインスタンスを1つずつ辿って
 * 出どころを1通りの規則で引くので、同じ移動が二重に飛ぶことは構造上起きない。
 *
 * 出どころの規則（resolve）: 置いたままの分身が運ぶもの → 掴んで離した場所 → 差し替え前の
 * 持ち主の枠 → origin（探索・クラフトの出どころ）→ 不明。
 */

/** 計画に映る1枚のカード。実体が何か（Card）は実行側だけが知る。 */
export interface PlacedCard<C> {
  readonly card: C;
  /** 映しているインスタンスのID（CardContent.identity）。 */
  readonly ids: readonly number[];
  readonly rect: Rect;
}

export interface MotionInput<C> {
  /** 差し替え前にレーンに居たカード。 */
  readonly before: readonly PlacedCard<C>[];
  /**
   * 差し替えで枠の外から所定の位置へ動かすカード（新しく現れたもの・掴んで離したまま残ったもの）。
   * 処理順がそのまま、生まれたものが飛び立つ順になる。
   */
  readonly arriving: readonly PlacedCard<C>[];
  /** 差し替え後も居続けるカード。カード自身は滑って動く（CardLane）ので、飛ぶのは移ったインスタンスだけ。 */
  readonly staying: readonly PlacedCard<C>[];
  /** 居なくなったカード。 */
  readonly left: readonly { readonly card: C; readonly ids: readonly number[] }[];
  /** 差し替え前に画面のどこにも無かったインスタンスの出どころ（探索・クラフトで生まれたもの）。 */
  readonly origin?: Rect;
  /** 掴んで離したインスタンスと、手を離した場所。 */
  readonly released?: { readonly id: number; readonly rect: Rect };
  /** 置いたままの分身（CardMotion.hold）が運ぶインスタンス。飛ぶのは分身なので、通常の便は立てない。 */
  readonly heldId?: number;
}

/** 分身1枚の飛行。 */
export interface PlannedFlight<C> {
  /** 分身の見た目を借りるカード（行き先のカード）。 */
  readonly face: C;
  readonly from: Rect;
  readonly to: Rect;
  /** 飛び立ちを遅らせる段数（1段＝送りの最短間隔。実時間にするのは実行側）。 */
  readonly delaySteps: number;
  /** 着いた時点で表に返すカード（伏せて待たせた札束は、最後の1枚が着いたときに表へ返る）。 */
  readonly reveals?: C;
}

export interface MotionPlan<C> {
  readonly flights: readonly PlannedFlight<C>[];
  /** 便が着くまで伏せて待つカード。 */
  readonly hidden: readonly C[];
  /** 出どころが分からず、その場で浮かび上がらせるカード。 */
  readonly fadeIns: readonly C[];
  /** 即座に片付けるカード（居なくなったもの全部。残ったインスタンスの移動は便が見せている）。 */
  readonly discards: readonly C[];
  /** 置いたままの分身の行き先（heldIdのインスタンスが差し替え後も居る場合だけ）。 */
  readonly landing?: { readonly to: Rect; readonly reveals: C };
}

export function planMotion<C>(input: MotionInput<C>): MotionPlan<C> {
  const before = new Map<number, PlacedCard<C>>();
  for (const placed of input.before) for (const id of placed.ids) before.set(id, placed);

  const flights: PlannedFlight<C>[] = [];
  const hidden: C[] = [];
  const fadeIns: C[] = [];
  let landing: MotionPlan<C>['landing'];
  // 生まれたものは差し替え全体で通し番号を取り、1枚ずつ間を置いて飛び立つ。
  let born = 0;

  /** そのインスタンスの出どころ（唯一の規則）。undefinedは「飛ばさない」。 */
  const resolve = (
    id: number,
    to: PlacedCard<C>,
    arriving: boolean,
  ): { rect: Rect; born: boolean } | undefined => {
    if (id === input.released?.id) return { rect: input.released.rect, born: false };

    const previous = before.get(id);
    if (previous !== undefined) {
      // 居続けるカードが持ち続けているインスタンスは動いていない。枠の外から戻るカード（arriving）は
      // 同じカードでも置き直されているので、元の枠から飛ばす。
      if (!arriving && previous.card === to.card) return undefined;
      return { rect: previous.rect, born: false };
    }
    return input.origin === undefined ? undefined : { rect: input.origin, born: true };
  };

  const planArrivalsTo = (to: PlacedCard<C>, arriving: boolean): void => {
    let held = false;
    const sources: { rect: Rect; born: boolean }[] = [];
    for (const id of to.ids) {
      if (id === input.heldId) held = true;
      else {
        const source = resolve(id, to, arriving);
        if (source !== undefined) sources.push(source);
      }
    }
    // 何を映しているか分からないカード（identityを持たないもの）は、1枚として出どころから飛ばす。
    if (to.ids.length === 0 && arriving && input.origin !== undefined) {
      sources.push({ rect: input.origin, born: true });
    }

    if (held) landing = { to: to.rect, reveals: to.card };

    if (sources.length === 0) {
      if (arriving && !held) fadeIns.push(to.card);
      return;
    }

    if (arriving) hidden.push(to.card);
    let stagger = 0;
    const planned: PlannedFlight<C>[] = sources.map((source) => ({
      face: to.card,
      from: source.rect,
      to: to.rect,
      delaySteps: source.born ? born++ : stagger++,
    }));
    // 伏せた札を表に返すのは、最も遅く飛び立つ1枚（＝最後に着く1枚）。置いたままの分身が
    // 着地するカードでは、分身の着地が表に返す（landing）。
    if (arriving && !held) {
      let last = 0;
      planned.forEach((flight, index) => {
        if (flight.delaySteps >= planned[last].delaySteps) last = index;
      });
      planned[last] = { ...planned[last], reveals: to.card };
    }
    flights.push(...planned);
  };

  for (const placed of input.arriving) planArrivalsTo(placed, true);
  for (const placed of input.staying) planArrivalsTo(placed, false);

  return {
    flights,
    hidden,
    fadeIns,
    // 居なくなったカードは飛ばさず即座に消える。残ったインスタンスの移動は行き先の側の便が
    // 見せているし、どこにも残らなかったのなら破棄（その場で消える。薄れさせると、掴んで
    // 離したカードが即座に消えるのと食い違って見える）。
    discards: input.left.map(({ card }) => card),
    landing,
  };
}
