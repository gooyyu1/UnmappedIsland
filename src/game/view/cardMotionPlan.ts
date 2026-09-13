/**
 * レーンの差し替えを「どの札がどこからどこへ飛ぶか」に翻訳する計画（CardInteraction.md 6節）。実行はCardTableが行い、ここは何も表示しない純粋な計算だけ。
 *
 * カードの実体Cも枠の矩形Rも、不透明な型として運ぶだけで読まない。**計画が座標に依存しないことは、
 * 総称であること自体が保証する**——依存した瞬間に型が通らなくなる。
 *
 * **1つのインスタンスの移動は1回だけ見せる**。計画は差し替え後のインスタンスを1つずつ辿って
 * 出どころを1通りの規則で引くので、同じ移動が二重に飛ぶことは構造上起きない。
 *
 * 出どころの規則（resolve）: 掴んで離した場所 → 差し替え前の持ち主の枠 → origins（世界の変化が
 * 言う出どころ）→ 不明。今運ばれている最中のもの（aloft）はこの規則の手前で外れ、便は立たない
 * ——動かしているのは実行側なので、行き先だけを答える（landings）。
 *
 * **宙に在る札はまだ行き先の枠に居ない**（ShownCard）。世界はもう動かし終えているが、画面はこれから
 * 運ぶので、運び終えるまでその枠の枚数から引く。1枚も居なくなる枠が「札の出ない枠」になるのも、
 * この引き算の結果でしかない。子ウィンドウが借りた1枚も、借りた側の枠に並ぶ普通の札として通る
 * （Windows.md 1.1節）——並びを引くのは画面の側（ShownCards）の仕事で、ここは知らない。
 *
 * 砂埃（6.1節）を立てる場所もここが決める。**立つのは世界の出入りだけ**で、レーンから居なくなった
 * ことでも現れたことでもない（vanished / born）。
 *
 * 突進（HuntingSystem.md 6.1節）もここが組み立てる。**突き当たる先は、差し替え前の並び（before）が
 * 持っている**——相手の札は差し替えで消えるので、その手前でしか矩形を引けない。
 */

/** 計画に映る1枚のカード。実体が何か（Card）も矩形が何か（Rect）も実行側だけが知る。 */
export interface PlacedCard<C, R> {
  readonly card: C;
  /** 映しているインスタンスのID（CardContent.identity）。 */
  readonly ids: readonly number[];
  readonly rect: R;
}

export interface MotionInput<C, R> {
  /** 差し替え前にレーンに居たカード。 */
  readonly before: readonly PlacedCard<C, R>[];
  /**
   * 差し替えで枠の外から所定の位置へ動かすカード（新しく現れたもの・掴んで離したまま残ったもの）。
   * 処理順がそのまま、生まれたものが飛び立つ順になる。
   */
  readonly arriving: readonly PlacedCard<C, R>[];
  /** 差し替え後も居続けるカード。カード自身は滑って動く（CardLane）ので、飛ぶのは移ったインスタンスだけ。 */
  readonly staying: readonly PlacedCard<C, R>[];
  /** 居なくなったカード。 */
  readonly left: readonly { readonly card: C; readonly ids: readonly number[] }[];
  /**
   * 差し替え前に画面のどこにも無かったインスタンスの出発点を、そのインスタンスごとに引いたもの
   * （MotionContext.origins）。持たないインスタンスは、出どころが分からないものとして扱う。
   */
  readonly origins?: ReadonlyMap<number, R>;
  /**
   * 手から放したインスタンスたちと、手を離した場所。ついてきて一緒に落とされたぶんも、指の下に
   * 居たのだから同じ場所から動き出す。heldIdが混ざっていてもよい——そちらの規則が先に効く。
   */
  readonly released?: { readonly ids: readonly number[]; readonly rect: R };
  /**
   * 今その枠へ運ばれている最中・その枠から持ち出されているインスタンス（飛んでいる便・落としたまま
   * 置いてある札）。**まだ枠には居ないので数から引き、新しい便も立てない**——運びはもう始まって
   * いるので、行き先だけを答える（landings）。
   */
  readonly aloft?: readonly number[];
  /**
   * 世界から出たインスタンス（壊れた・使い切った）。**leftでは代われない**——別のレーンへ移った
   * だけのカードもそこに並ぶので、消えたのか運ばれたのかは世界の変化だけが知っている。
   */
  readonly vanished?: readonly number[];
  /** 世界に生まれたインスタンス。こちらもbeforeに居ないだけでは区別できない（移ってきた物と同じ）。 */
  readonly born?: readonly number[];
  /**
   * 突進した個体と、手を出した相手の候補（changedInstances.lungeTargetsByInstance）。**相手を1つに
   * 決めるのはここ**——画面に出ている候補を選ぶ。1つも出ていなければ突進は立たない。
   */
  readonly lunges?: ReadonlyMap<number, readonly number[]>;
}

/** 札1枚の飛行。 */
export interface PlannedFlight<C, R> {
  /** この便が運ぶインスタンス。実行側はこのIDを載せた実体の札を飛ばし、着いた枠で合流させる。 */
  readonly id: number;
  /** その1枚が着く枠の札。着いた時点で、その枠に居る枚数が1つ増え、便はこの札の見た目を借りる。 */
  readonly into: C;
  readonly from: R;
  readonly to: R;
  /** 飛び立ちを遅らせる段数（1段＝送りの最短間隔。実時間にするのは実行側）。 */
  readonly delaySteps: number;
  /** 着いた時点で砂埃を立てるか（生まれたインスタンスを運ぶ便）。 */
  readonly raisesDust: boolean;
}

/**
 * 1件の突進——主体の札が、手を出した相手の枠まで行って、突き当たり、自分の枠へ帰る
 * （HuntingSystem.md 6.1節）。**行って帰るまでの間、その個体はどの枠にも居ない**（便・置いたままの札に
 * 続く3つ目の、宙に在る札）。
 */
export interface PlannedLunge<C, R> {
  /** 突進するインスタンス。帰り着いた枠で合流する。 */
  readonly id: number;
  /** 帰って合流する枠の札と、その枠（差し替え後の位置）。 */
  readonly into: C;
  readonly home: R;
  /**
   * 駆け出す場所。**その個体が差し替えの前に居た所**なので、探索で出くわしたその手番に手を出した
   * 個体は出どころ（origins）から駆け出す——居なかった物の「元の枠」は画面のどこにも無い。
   */
  readonly from: R;
  /** 突き当たる先——相手が差し替え前に居た枠。 */
  readonly to: R;
  /**
   * 突き当たられて枠から居なくなる札。**片付けるのは着いてから**なので、それまで相手の枠に
   * 出したままにする。束の一部だけを持ち去られた札はその場に残るので、持たない。
   */
  readonly struck: C | undefined;
  /** 突き当たった時点で砂埃を立てるか（相手が世界から出た回）。 */
  readonly raisesDust: boolean;
}

/** 差し替えの直後に、その札の枠に在るインスタンス。枚数はここからの導出値。 */
export interface ShownCard<C> {
  readonly card: C;
  /** 映しているインスタンスのうち、まだ宙に在るもの（便・運ばれている札）を除いた集合。 */
  readonly present: readonly number[];
  /**
   * 0枚になったときに、帰ってくる場所を示す印を残すか。**元から居た札を持ち出された枠**だけが残す。
   * まだ1枚も来ていない枠には出さない——そこに在ったことのない札の帰る場所は無い。
   */
  readonly emptied: boolean;
}

export interface MotionPlan<C, R> {
  readonly flights: readonly PlannedFlight<C, R>[];
  /** この差し替えで始まる突進。 */
  readonly lunges: readonly PlannedLunge<C, R>[];
  /** 差し替えの直後の各札の見せ方（レーンに並ぶカード全部ぶん）。 */
  readonly shown: readonly ShownCard<C>[];
  /** 出どころが分からず、その場で浮かび上がらせるカード。 */
  readonly fadeIns: readonly C[];
  /** 即座に片付けるカード（居なくなったもの全部。残ったインスタンスの移動は便が見せている）。 */
  readonly discards: readonly C[];
  /** その場ですぐ砂埃を立てる枠（消えた札の居場所と、飛ばずに現れた札の居場所）。 */
  readonly puffs: readonly R[];
  /**
   * 持ち出されているインスタンス（aloft）の帰り先——差し替え後にそのインスタンスを映している枠。
   * **返すかどうかは持ち出した側が決める**ので、ここは行き先を答えるだけ。世界から出ていれば
   * 帰り先を持たない。
   */
  readonly landings: ReadonlyMap<number, { readonly to: R; readonly into: C }>;
}

export function planMotion<C, R>(input: MotionInput<C, R>): MotionPlan<C, R> {
  const before = new Map<number, PlacedCard<C, R>>();
  for (const placed of input.before) for (const id of placed.ids) before.set(id, placed);

  const flights: PlannedFlight<C, R>[] = [];
  const shown: ShownCard<C>[] = [];
  const fadeIns: C[] = [];
  const puffs: R[] = [];
  const landings = new Map<number, { to: R; into: C }>();
  const aloft = new Set(input.aloft ?? []);
  // 現れたものは差し替え全体で通し番号を取り、1枚ずつ間を置いて飛び立つ。
  let appeared = 0;

  const bornIds = new Set(input.born ?? []);
  const vanishedIds = new Set(input.vanished ?? []);

  // 差し替え後の居場所。突進した個体が帰るのは、この差し替えで決まった枠。
  const after = new Map<number, PlacedCard<C, R>>();
  for (const placed of [...input.arriving, ...input.staying])
    for (const id of placed.ids) after.set(id, placed);
  const leftCards = new Set(input.left.map(({ card }) => card));

  // 砂埃は**1枚の札につき1回**——3個の束が丸ごと消えても、居なくなった札は1枚だから。突進が
  // 引き取った札の分はその突進が着いてから立てるので、ここで先に取り合いを済ませる。
  const dusted = new Set<C>();

  const lunges: PlannedLunge<C, R>[] = [];
  // 突き当たられた側。片付けるのも突進が着いてからなので、この差し替えでは消さない。
  const struckIds = new Set<number>();
  const struckCards = new Set<C>();
  for (const [id, candidates] of input.lunges ?? []) {
    if (aloft.has(id)) continue;

    const home = after.get(id);
    if (home === undefined) continue;

    // **手を出した相手は、画面に出ている候補のうち最初のもの。** 起きた順の先頭とは限らない
    // （壊れた入れ物の中身は、入れ物の消滅より先に記録される）。指が運んだ物は、その動きを指が
    // 既に見せているので相手にしない（released）。
    const targetId = candidates.find(
      (candidate) =>
        input.released?.ids.includes(candidate) !== true &&
        before.get(candidate) !== undefined &&
        before.get(candidate) !== home,
    );
    const target = targetId === undefined ? undefined : before.get(targetId);
    if (targetId === undefined || target === undefined) continue;

    // 相手の札を引き取るのは1つの突進だけ。2匹が同じ束へ手を出しても、片付けは1回。
    const struck = leftCards.has(target.card) && !struckCards.has(target.card) ? target.card : undefined;
    const raisesDust = vanishedIds.has(targetId) && !dusted.has(target.card);
    lunges.push({
      id,
      into: home.card,
      home: home.rect,
      from: before.get(id)?.rect ?? input.origins?.get(id) ?? home.rect,
      to: target.rect,
      struck,
      raisesDust,
    });
    // 突進している間、その個体はどの枠にも居ない。引き算は運びの最中の札と同じ。
    aloft.add(id);
    struckIds.add(targetId);
    if (struck !== undefined) struckCards.add(struck);
    if (raisesDust) dusted.add(target.card);
  }

  // 消えた札は、差し替え前に居た枠で砂埃を立てる。画面に出ていなかったものは枠を持たず、何も立たない。
  for (const id of vanishedIds) {
    const placed = before.get(id);
    if (placed === undefined || dusted.has(placed.card) || struckIds.has(id)) continue;
    dusted.add(placed.card);
    puffs.push(placed.rect);
  }

  /** そのインスタンスの出どころ（唯一の規則）。undefinedは「飛ばさない」。 */
  const resolve = (
    id: number,
    to: PlacedCard<C, R>,
    arriving: boolean,
  ): { rect: R; appeared: boolean } | undefined => {
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

  const planArrivalsTo = (to: PlacedCard<C, R>, arriving: boolean): void => {
    let held = 0;
    // 生まれたのに出どころが分からないもの。飛ぶ便が無いので、着いた先で砂埃だけを立てる。
    let bornInPlace = false;
    const present: number[] = [];
    const sources: { id: number; rect: R; appeared: boolean; raisesDust: boolean }[] = [];
    for (const id of to.ids) {
      if (aloft.has(id)) {
        held += 1;
        landings.set(id, { to: to.rect, into: to.card });
      } else {
        const source = resolve(id, to, arriving);
        if (source === undefined) {
          bornInPlace ||= bornIds.has(id);
          present.push(id);
        } else sources.push({ id, ...source, raisesDust: bornIds.has(id) });
      }
    }
    if (bornInPlace) puffs.push(to.rect);

    // 運ばれている最中の札はまだここに居ない。1枚も居なければ札は出ないが、それは空集合という結果で
    // あって別扱いではない——束の一部が宙に在るなら、残りだけが見えている。
    //
    // 印を残すのは、元から居た札を持ち出された枠（staying）だけ。枠の外から来る途中の札を待って
    // いる枠（arriving）は、まだ何も在ったことがない。
    shown.push({ card: to.card, present, emptied: !arriving });

    if (sources.length === 0) {
      if (arriving && held === 0) fadeIns.push(to.card);
    } else {
      let stagger = 0;
      for (const source of sources) {
        flights.push({
          id: source.id,
          into: to.card,
          from: source.rect,
          to: to.rect,
          delaySteps: source.appeared ? appeared++ : stagger++,
          raisesDust: source.raisesDust,
        });
      }
    }
  };

  for (const placed of input.arriving) planArrivalsTo(placed, true);
  for (const placed of input.staying) planArrivalsTo(placed, false);

  return {
    flights,
    lunges,
    shown,
    fadeIns,
    // 居なくなったカードは飛ばさず即座に消える。残ったインスタンスの移動は行き先の側の便が
    // 見せているし、どこにも残らなかったのなら破棄（その場で消える。薄れさせると、掴んで
    // 離したカードが即座に消えるのと食い違って見える）。突き当たられた札だけは、突進が着くまで
    // 残る（PlannedLunge.struck）。
    discards: input.left.map(({ card }) => card).filter((card) => !struckCards.has(card)),
    puffs,
    landings,
  };
}
