import type { Rect } from '../layout/ScreenMetrics';

/**
 * レーンの差し替えを「どの札がどこからどこへ飛ぶか」に翻訳する計画（CardInteraction.md 6節）。実行はCardMotionが行い、ここは何も表示しない純粋な計算だけ。
 *
 * **1つのインスタンスの移動は1回だけ見せる**。計画は差し替え後のインスタンスを1つずつ辿って
 * 出どころを1通りの規則で引くので、同じ移動が二重に飛ぶことは構造上起きない。
 *
 * 出どころの規則（resolve）: 置いたままの分身が運ぶもの → 掴んで離した場所 → 差し替え前の
 * 持ち主の枠 → origins（世界の変化が言う出どころ）→ 不明。
 *
 * **宙に在る札はまだ行き先の枠に居ない**（ShownCard）。世界はもう動かし終えているが、画面はこれから
 * 運ぶので、運び終えるまでその枠の枚数から引く。1枚も居なくなる枠が「札の出ない枠」になるのも、
 * この引き算の結果でしかない。
 *
 * 砂埃（6.1節）を立てる場所もここが決める。**立つのは世界の出入りだけ**で、レーンから居なくなった
 * ことでも現れたことでもない（vanished / born）。
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
  /**
   * 差し替え前に画面のどこにも無かったインスタンスの出発点を、そのインスタンスごとに引いたもの
   * （MotionContext.origins）。持たないインスタンスは、出どころが分からないものとして扱う。
   */
  readonly origins?: ReadonlyMap<number, Rect>;
  /**
   * 手から放したインスタンスたちと、手を離した場所。ついてきて一緒に落とされたぶんも、指の下に
   * 居たのだから同じ場所から動き出す。heldIdが混ざっていてもよい——そちらの規則が先に効く。
   */
  readonly released?: { readonly ids: readonly number[]; readonly rect: Rect };
  /**
   * 今その枠から持ち出されているインスタンス——置いたままの分身が運ぶもの（CardMotion.hold）と、
   * 子ウィンドウが借りている札（Windows.md 1.1節）。**どちらも枠には居ないので数から引き、通常の
   * 便も立てない**（動かすのは持ち出した側で、いつ返すのかもその側が決める）。
   */
  readonly aloft?: readonly number[];
  /**
   * 世界から出たインスタンス（壊れた・使い切った）。**leftでは代われない**——別のレーンへ移った
   * だけのカードもそこに並ぶので、消えたのか運ばれたのかは世界の変化だけが知っている。
   */
  readonly vanished?: readonly number[];
  /** 世界に生まれたインスタンス。こちらもbeforeに居ないだけでは区別できない（移ってきた物と同じ）。 */
  readonly born?: readonly number[];
}

/** 分身1枚の飛行。 */
export interface PlannedFlight<C> {
  /** 分身の見た目を借りるカード（行き先のカード）。 */
  readonly face: C;
  /** 分身が運んでいる1枚の行き先。着いた時点で、その枠に居る枚数が1つ増える。 */
  readonly into: C;
  readonly from: Rect;
  readonly to: Rect;
  /** 飛び立ちを遅らせる段数（1段＝送りの最短間隔。実時間にするのは実行側）。 */
  readonly delaySteps: number;
  /** 着いた時点で砂埃を立てるか（生まれたインスタンスを運ぶ便）。 */
  readonly puffs: boolean;
}

/** 差し替えの直後に、その札が見せる枚数。 */
export interface ShownCard<C> {
  readonly card: C;
  /** 映しているインスタンスのうち、まだ宙に在るもの（便・置いたままの分身）を除いた数。 */
  readonly remaining: number;
  /**
   * 0枚になったときに、帰ってくる場所を示す印を残すか。**元から居た札を持ち出された枠**だけが残す。
   * まだ1枚も来ていない枠には出さない——そこに在ったことのない札の帰る場所は無い。
   */
  readonly emptied: boolean;
}

export interface MotionPlan<C> {
  readonly flights: readonly PlannedFlight<C>[];
  /** 差し替えの直後の各札の見せ方（レーンに並ぶカード全部ぶん）。 */
  readonly shown: readonly ShownCard<C>[];
  /** 出どころが分からず、その場で浮かび上がらせるカード。 */
  readonly fadeIns: readonly C[];
  /** 即座に片付けるカード（居なくなったもの全部。残ったインスタンスの移動は便が見せている）。 */
  readonly discards: readonly C[];
  /** その場ですぐ砂埃を立てる枠（消えた札の居場所と、飛ばずに現れた札の居場所）。 */
  readonly puffs: readonly Rect[];
  /**
   * 持ち出されているインスタンス（aloft）の帰り先——差し替え後にそのインスタンスを映している枠。
   * **返すかどうかは持ち出した側が決める**ので、ここは行き先を答えるだけ。世界から出ていれば
   * 帰り先を持たない。
   */
  readonly landings: ReadonlyMap<number, { readonly to: Rect; readonly into: C }>;
}

export function planMotion<C>(input: MotionInput<C>): MotionPlan<C> {
  const before = new Map<number, PlacedCard<C>>();
  for (const placed of input.before) for (const id of placed.ids) before.set(id, placed);

  const flights: PlannedFlight<C>[] = [];
  const shown: ShownCard<C>[] = [];
  const fadeIns: C[] = [];
  const puffs: Rect[] = [];
  const landings = new Map<number, { to: Rect; into: C }>();
  const aloft = new Set(input.aloft ?? []);
  // 現れたものは差し替え全体で通し番号を取り、1枚ずつ間を置いて飛び立つ。
  let appeared = 0;

  // 消えた札は、差し替え前に居た枠で砂埃を立てる。**1枚の札につき1回**——3個の束が丸ごと
  // 消えても、居なくなった札は1枚だから。画面に出ていなかったものは枠を持たず、何も立たない。
  const dusted = new Set<C>();
  const bornIds = new Set(input.born ?? []);
  for (const id of input.vanished ?? []) {
    const placed = before.get(id);
    if (placed === undefined || dusted.has(placed.card)) continue;
    dusted.add(placed.card);
    puffs.push(placed.rect);
  }

  /** そのインスタンスの出どころ（唯一の規則）。undefinedは「飛ばさない」。 */
  const resolve = (
    id: number,
    to: PlacedCard<C>,
    arriving: boolean,
  ): { rect: Rect; appeared: boolean } | undefined => {
    if (input.released?.ids.includes(id) === true) {
      return { rect: input.released.rect, appeared: false };
    }

    const previous = before.get(id);
    if (previous !== undefined) {
      // 居続けるカードが持ち続けているインスタンスは動いていない。枠の外から戻るカード（arriving）は
      // 同じカードでも置き直されているので、元の枠から飛ばす。
      if (!arriving && previous.card === to.card) return undefined;
      return { rect: previous.rect, appeared: false };
    }

    const origin = input.origins?.get(id);
    return origin === undefined ? undefined : { rect: origin, appeared: true };
  };

  const planArrivalsTo = (to: PlacedCard<C>, arriving: boolean): void => {
    let held = 0;
    // 生まれたのに出どころが分からないもの。飛ぶ便が無いので、着いた先で砂埃だけを立てる。
    let bornInPlace = false;
    const sources: { rect: Rect; appeared: boolean; puffs: boolean }[] = [];
    for (const id of to.ids) {
      if (aloft.has(id)) {
        held += 1;
        landings.set(id, { to: to.rect, into: to.card });
      } else {
        const source = resolve(id, to, arriving);
        if (source === undefined) bornInPlace ||= bornIds.has(id);
        else sources.push({ ...source, puffs: bornIds.has(id) });
      }
    }
    if (bornInPlace) puffs.push(to.rect);

    // 運ばれている最中の札はまだここに居ない。1枚も居なければ札は出ないが、それは0枚という結果で
    // あって別扱いではない——束の一部が宙に在るなら、残りはその枚数で見えている。
    //
    // 印を残すのは、元から居た札を持ち出された枠（staying）だけ。枠の外から来る途中の札を待って
    // いる枠（arriving）は、まだ何も在ったことがない。
    shown.push({
      card: to.card,
      remaining: to.ids.length - sources.length - held,
      emptied: !arriving,
    });

    if (sources.length === 0) {
      if (arriving && held === 0) fadeIns.push(to.card);
      return;
    }

    let stagger = 0;
    for (const source of sources) {
      flights.push({
        face: to.card,
        into: to.card,
        from: source.rect,
        to: to.rect,
        delaySteps: source.appeared ? appeared++ : stagger++,
        puffs: source.puffs,
      });
    }
  };

  for (const placed of input.arriving) planArrivalsTo(placed, true);
  for (const placed of input.staying) planArrivalsTo(placed, false);

  return {
    flights,
    shown,
    fadeIns,
    // 居なくなったカードは飛ばさず即座に消える。残ったインスタンスの移動は行き先の側の便が
    // 見せているし、どこにも残らなかったのなら破棄（その場で消える。薄れさせると、掴んで
    // 離したカードが即座に消えるのと食い違って見える）。
    discards: input.left.map(({ card }) => card),
    puffs,
    landings,
  };
}
