import type { WorldObject } from './WorldObject';
import type { Rng } from './Rng';
import { INT32_MAX } from '../util/int32';
import type { ActiveEffect } from './ActiveEffect';
import { ActiveEffectSequence, ConditionalEffect, SetEffect } from './ActiveEffect';
import type { ConditionNode } from './ConditionNode';
import { PropertyPath } from './ReferenceRoot';
import type { EffectDeclaration } from './EffectReader';
import type { AlertLevel } from './AlertLevel';
import { ALERT_LEVELS } from './AlertLevel';

/**
 * 値がどちらへ動くと悪いか（PropertyDef.alertDirection）。mixedは「両端が悪い」並びで、バーの
 * 向きを決められない。
 */
export type AlertDirection = 'up' | 'down' | 'mixed';

/**
 * ゲージ（6.8節）の端の見せ方。`good`は満ち足りている端、`bad`は尽きている・行き過ぎている端、
 * `neutral`は良し悪しを言わない端。**色はこの2つの端だけで決まる**ので、UI側は何のプロパティかを
 * 知らずに塗れる。
 */
export type GaugeEnd = 'good' | 'bad' | 'neutral';

/**
 * 著者が書いたrangeイベント1つ（`on_max`/`on_min`、6.3節）。`conditions`を書いていればその条件も持ち、
 * **満たさない回は既定のクランプへ倒れる**（ConditionalEffect参照）。
 */
export interface RangeEventDef {
  readonly condition: ConditionNode | undefined;
  readonly effect: ActiveEffect;
}

export const GAUGE_ENDS: readonly GaugeEnd[] = ['good', 'bad', 'neutral'];

/**
 * そのプロパティをカードのゲージとして見せる宣言（6.8節、docs/ui/CardView.md 8節）。
 *
 * **「ゲージとして出すか」と「両端がどう見えるか」だけを持つ。** 耐久度・炉の残り薪・残っている傷・
 * 意識・工程の進捗は、いずれも「rangeに対する割合を1本のバーで見せる」点では同じで、違うのは
 * どちらの端が良いかだけ。それをここで宣言すれば、UI側にプロパティ名の対応表が要らなくなる。
 */
export class GaugeDef {
  /** rangeの下限に居るときの見せ方。 */
  readonly atMin: GaugeEnd;

  /** rangeの上限に居るときの見せ方。 */
  readonly atMax: GaugeEnd;

  constructor(atMin: GaugeEnd, atMax: GaugeEnd) {
    this.atMin = atMin;
    this.atMax = atMax;
  }

  /**
   * 値が増えるほど悪いか（変化の帯をどちら向きに出すか）。**両端の宣言から決まる**ので、
   * stagesのalertから導く`alertDirection`とは別に書かせない（両者の食い違いはロード時に弾く）。
   */
  get worsensUpward(): boolean {
    return this.atMax === 'bad';
  }

  /** 良し悪しを言う端を持つか（片方でも good/bad ならtrue）。両端neutralのゲージは向きを持たない。 */
  get hasDirection(): boolean {
    return this.atMin !== 'neutral' || this.atMax !== 'neutral';
  }
}

/** 6.3節の値域。 */
export class PropertyRange {
  readonly min: number;
  readonly max: number;

  constructor(min: number, max: number) {
    this.min = min;
    this.max = max;
  }

  /** 値をこの範囲内に収める（GameElementDefinition.md 6.3節）。 */
  clamp(value: number): number {
    return value < this.min ? this.min : value > this.max ? this.max : value;
  }
}

/**
 * 6.4節の stages の1段。minとeqはいずれか一方のみ有効（どちらが有効かは持ち主の型で決まるので、
 * 両方の指定は PropertyDef が型と段を突き合わせて拒否する）。
 * min: 下限のみの半開区間（数値プロパティ向け）。eq: 完全一致判定（シンボル型プロパティ（6.6節）向け）。
 * どちらも未指定ならフォールバック段（どの段にも該当しない場合の受け皿、6.4節）。
 */
export class PropertyStage {
  readonly name: string;

  /** 下限。undefinedは最下段（それより下の残り全ての値を拾う、6.4節）、またはeq指定時。 */
  readonly min: number | undefined;

  /**
   * 完全一致判定の対象値。**持ち主がシンボル型（6.6節）のときに限り、段名そのもののシンボルIDが入る**
   * （parseProperty）。数値型の段は持たないので、**シンボル型かどうかを訊きたい側はこれではなく
   * `PropertyDef.isSymbolic` を見る**。
   */
  readonly eq: number | undefined;

  /** この段にいる間、値がどの域にあると見なすか（6.4節のalert）。 */
  readonly alert: AlertLevel;

  /**
   * この段にいる間カードに出す絵の接尾辞（`art_by_stage`、6.4節）。`src/assets/objects/
   * <object_defの識別子>_<この値>.png` を指す。宣言しない段はundefinedで、その型の絵のまま。
   */
  readonly art: string | undefined;

  /**
   * この段にいる間、状況アイコンとして出す絵の識別子（6.4節の`situation`）。
   * `src/assets/icons/<この値>.png` を指す（docs/ui/ScreenLayout.md 4.1.1節）。宣言しない段では
   * 何も出ない——**出すかとどの絵かを1つの宣言に畳んである**ので、undefinedは「出さない」と読む。
   */
  readonly situation: string | undefined;

  constructor(
    name: string,
    min: number | undefined,
    eq?: number,
    alert: AlertLevel = 'safe',
    art?: string,
    situation?: string,
  ) {
    this.name = name;
    this.min = min;
    this.eq = eq;
    this.alert = alert;
    this.art = art;
    this.situation = situation;
  }

  /**
   * その値がこの段に該当するか。**受け皿はどの値にも該当しない**——どれにも該当しなかったときに
   * 選ばれるものなので、自分から名乗り出ない（選ぶのは PropertyDef.stageAt）。
   */
  matches(value: number): boolean {
    return this.eq !== undefined ? value === this.eq : this.min !== undefined && value >= this.min;
  }

  /**
   * 値の並びの上でのこの段の下端。**持たない段がある**——完全一致で決まる段（シンボル型、6.6節）は
   * 値の並びの上に位置を持たず、受け皿は下端が range の下限そのものなので段の側では決まらない。
   */
  get lowerBound(): number | undefined {
    return this.eq !== undefined ? undefined : this.min;
  }
}

/** 初期値の宣言（PropertyDef.initialValueReading参照）。 */
export type InitialValueReading =
  | { readonly kind: 'fixed'; readonly value: number }
  | { readonly kind: 'roll'; readonly min: number; readonly max: number };

/** range系イベント（6.3節）の名前。 */
export type RangeEventLabel = 'on_max' | 'on_min';

/** 段（6.4節）がrangeの中で占める区間。両端とも0〜1で、startがminの側。 */
export interface StageSpan {
  readonly start: number;
  readonly end: number;
}

/**
 * 段（6.4節）の刻みと、その中で今どこにいるか（PropertyDef.stageReadingAt）。
 * nameは識別子であり表示名ではない（表示名はLocalization.stageが引く）。
 */
export interface CurrentStageReading {
  /** 今いる段の名前。 */
  readonly name: string;

  /** rangeの中でこの段が占める区間。rangeを持たないプロパティと、eqで決まる段ではundefined。 */
  readonly span: StageSpan | undefined;

  /** 段の境目（rangeの中での位置、昇順）。両端（range自身の上下限）は含まない。 */
  readonly boundaries: readonly number[];
}

/**
 * 1つの ObjectDef が持つ、1つのプロパティの定義（6節）。ObjectDef.propertyDefs の1要素として、
 * ローカルIDをそのままindexとする密配列に格納される。同名プロパティでも ObjectDef ごとに
 * range/stages/デフォルト値が異なりうるため、定義はObjectDefごとに個別に持つ。
 * range系イベント（on_*）の発火判定・stages判定・初期値決定はこのPropertyDef自身の責務で、
 * PropertyValueは値の変更を通知するだけ。
 */
export class PropertyDef {
  readonly globalId: number;
  readonly name: string;

  /** 抽選を経ない初期値（スカラー）。initialValueRangeを持つ場合は、RNGを使わない生成でのフォールバック（= range.min）。 */
  readonly initialValueWithoutRoll: number;

  /** value: {min, max} 記法による初期値のランダム範囲（6.2節、rollInitialValue参照）。無ければundefined。 */
  private readonly initialValueRange: PropertyRange | undefined;

  /** 初期値の宣言（6.2節）。抽選つきならその範囲、そうでなければ固定値。 */
  get initialValueReading(): InitialValueReading {
    return this.initialValueRange !== undefined
      ? { kind: 'roll', min: this.initialValueRange.min, max: this.initialValueRange.max }
      : { kind: 'fixed', value: this.initialValueWithoutRoll };
  }

  /** 取りうる値域（6.3節）。on_max/on_minを使う場合は必須。使わない場合はundefined。 */
  readonly range: PropertyRange | undefined;

  /**
   * 著者が書いたon_max（6.3節）。書かれていなければundefinedで、その場合は既定のクランプ
   * （自分自身をrange.maxへset）が代わりに走る——どちらが走るかは{@link onMax}が答える。
   */
  private readonly declaredOnMax: ActiveEffect | undefined;

  /** 著者が書いたon_min（6.3節）。declaredOnMaxの下限側の鏡像。 */
  private readonly declaredOnMin: ActiveEffect | undefined;

  /**
   * on_max（6.3節）: 値がrange.max**に達した**とき（超えたときを含む）にselfへ一度だけ適用するactive内容。
   * 対象プロパティは自分自身（折り返し）でも他のプロパティ（繰り上げ先）でも構わない。著者が書かなかった
   * 場合は「自分自身をrange.maxへsetする」既定のクランプ——著者は`range`を書くだけでクランプが得られ、
   * 特別な挙動が要る場合だけon_maxを書けばよい。著者が`conditions`を書いた場合は、満たさない回だけが
   * 同じ既定のクランプへ倒れる（ConditionalEffect参照）。range自体が未定義の場合のみundefined。
   */
  private readonly onMax: ActiveEffect | undefined;

  /** on_min（6.3節）: on_maxの下限側の鏡像。値がrange.minに達したときにselfへ一度だけ適用する。 */
  private readonly onMin: ActiveEffect | undefined;

  /** 宣言されている段（6.4節）を宣言順に。1つも宣言していなければ空。 */
  readonly stages: readonly PropertyStage[];

  /** stages中のフォールバック段（min:undefined・eq:undefined）。stagesは不変のため一度だけ求める。該当が無ければundefined。 */
  private readonly fallbackStage: PropertyStage | undefined;

  /** stagesを1つでも持つか（art_by_stageの検証、6.4節）。 */
  get hasStages(): boolean {
    return this.stages.length > 0;
  }

  /** いずれかの段がart（6.4節）を宣言しているか（art_by_stageの検証）。 */
  readonly hasStageArt: boolean;

  /**
   * 値がどちらへ動くと悪いか。**専用の宣言は持たず、`stages`のalertから導く**——「どちらが危ないか」は
   * 既にalertが宣言しているので、同じことを二度書かせない。段を下から上へ見て、深刻さが単調に上がるなら
   * `up`（負荷など）、単調に下がるなら`down`（満腹度など）。上下どちらの端も悪い山なり・谷なりの並びは
   * `mixed`で、バーの向きを決められない（rangeを持つプロパティでは、ロード時にこれを拒む）。
   *
   * 見せ方（帯の向き・増減の記号の色）だけがこれを見る（StatusArea.md）。
   */
  readonly alertDirection: AlertDirection;

  /**
   * 値が増えるほど悪いか。ゲージを宣言していれば、その両端の見せ方（6.8節）が向きを決める——段の
   * alertと食い違う宣言はロード時に弾くので、両方あるときは必ず同じ答えになる。ゲージが無ければ
   * 段のalertの向きから決まり、`mixed`は向きを決められないので既定の「減ると悪い」として扱う。
   */
  get worsensUpward(): boolean {
    return this.gauge?.worsensUpward ?? this.alertDirection === 'up';
  }

  /**
   * base（6.5節）: 実効値の土台にする、他のプロパティへの参照。その実効値へ自分の値を加算する。
   * 書かれていなければundefinedで、実効値は自分の値から始まる。土台を辿れなければ寄与0。
   */
  readonly base: PropertyPath | undefined;

  /**
   * このプロパティに付いたタグのグローバルIDの一覧（6.7節）。object_defのタグ（4.1節）とは別の
   * 名前空間で、UIがプロパティをカテゴリ別にまとめるために使う。
   */
  readonly tags: readonly number[];

  /**
   * 値がシンボル（6.6節。天気の`clear`、季節の`dry`）か。実行時の値は数値なので、シンボル名へ
   * 戻せるかどうかはこの宣言だけが知っている（`DefNames.propertyValueToken`が使う）。
   */
  readonly isSymbolic: boolean;

  /**
   * 値が型（`object_defs`のグローバルID、6.9節。海区が名乗る隣）か。**シンボルと同じく実行時の値は
   * 数値なので、型の名前へ戻せるかどうかはこの宣言だけが知っている**（`DefNames.propertyValueToken`）。
   */
  readonly isObjectDef: boolean;

  /**
   * カードのゲージとして見せる宣言（6.8節）。持たないプロパティはバーにならない——「出すかどうか」は
   * この宣言の有無だけで決まり、UI側は名前を1つも知らない（docs/ui/CardView.md 8節）。
   */
  readonly gauge: GaugeDef | undefined;

  constructor(
    globalId: number,
    name: string,
    initialValue: number,
    initialValueRange: PropertyRange | undefined,
    range: PropertyRange | undefined,
    onMax: RangeEventDef | undefined,
    stages: readonly PropertyStage[],
    onMin?: RangeEventDef,
    base: PropertyPath | undefined = undefined,
    tags: readonly number[] = [],
    isSymbolic = false,
    gauge: GaugeDef | undefined = undefined,
    isObjectDef = false,
  ) {
    // シンボル型の段は名前そのものが比較対象なので、下限を持てない（6.6・6.4節）。**型と段の両方を
    // 見て初めて言えること**なので、段1つでは判定できない。**書かれたminを直に見る**——lowerBoundは
    // シンボル型の段では常にundefinedなので、ここでは検査したいものが見えない。
    if (isSymbolic && stages.some((stage) => stage.min !== undefined))
      throw new Error(
        `プロパティ'${name}'はシンボル型なので、段に'min'は書けません（段の'name'自体がそのまま比較対象になります）。`,
      );

    if (range === undefined) {
      // 割合が定義できないとバーにできず、端が無ければ端のイベントも起こりえない（6.3・6.8節）。
      if (gauge !== undefined) throw new Error(`プロパティ'${name}': gaugeを使うにはrangeが必要です。`);
      if (onMax !== undefined) throw new Error(`プロパティ'${name}': on_maxを使うにはrangeが必要です。`);
      if (onMin !== undefined) throw new Error(`プロパティ'${name}': on_minを使うにはrangeが必要です。`);
    }

    this.globalId = globalId;
    this.name = name;
    this.initialValueWithoutRoll = initialValue;
    this.initialValueRange = initialValueRange;
    this.range = range;
    this.declaredOnMax = onMax?.effect;
    this.declaredOnMin = onMin?.effect;
    this.onMax = rangeEventEffect(onMax, defaultClampEffect(range, globalId, true));
    this.stages = stages;
    this.onMin = rangeEventEffect(onMin, defaultClampEffect(range, globalId, false));
    this.base = base;
    this.tags = tags;
    this.isSymbolic = isSymbolic;
    this.isObjectDef = isObjectDef;
    this.gauge = gauge;

    // 受け皿（どの段にも該当しない値の行き先、6.4節）。**シンボル型は持ちえない**——段名がそのまま
    // 比較対象なので、どの段も必ず特定の値を名乗る。
    this.fallbackStage = isSymbolic ? undefined : stages.find((stage) => stage.min === undefined);
    this.alertDirection = PropertyDef.deriveAlertDirection(stages, isSymbolic);
    this.hasStageArt = stages.some((stage) => stage.art !== undefined);

    // ゲージの向きとstagesのalertの向きは、同じ「どちらが危ないか」を二度言うことになる。食い違って
    // いると片方だけが正しく見えて原因が分からなくなる（6.8節）。
    if (gauge?.hasDirection === true && this.alertDirection !== 'mixed' && stages.length > 0)
      if ((this.alertDirection === 'up') !== gauge.worsensUpward)
        throw new Error(
          `プロパティ'${name}': gaugeの向き（max: ${gauge.atMax}）とstagesのalertの向きが食い違っています。` +
            'どちらの端が危ないかは1つに揃えてください。',
        );

    // rangeを持つプロパティはバーとして描かれる（6.4節）。上下どちらの端も悪い並びでは、塗りの向きが
    // 「良い方へ伸びる」とも「悪い方へ伸びる」とも決められない。両側が悪い量（体温など）は、値そのもの
    // ではなく片側だけの度合い（熱中症・低体温症）を別のプロパティとして見せる。
    if (range !== undefined && this.alertDirection === 'mixed')
      throw new Error(
        `プロパティ'${name}': stagesのalertが上下どちらの端でも深刻になっています。rangeを持つプロパティは` +
          'バーとして描かれるため、深刻さは下から上へ単調でなければなりません。',
      );
  }

  /**
   * 数値の段を下から上へ並べ、alertの深刻さがどちらへ動くかを見る（シンボル型の段は大小関係を持たない
   * ため除く）。単調に上がるならup、単調に下がるならdown、どちらでもなければmixed。
   * 深刻さが動かない（段が無い・全段が同じ域）場合は、満タンが良いという既定に合わせてdown。
   */
  private static deriveAlertDirection(stages: readonly PropertyStage[], isSymbolic: boolean): AlertDirection {
    if (isSymbolic) return 'down';

    const severities = [...stages]
      .sort((a, b) => (a.lowerBound ?? Number.NEGATIVE_INFINITY) - (b.lowerBound ?? Number.NEGATIVE_INFINITY))
      .map((stage) => ALERT_LEVELS.indexOf(stage.alert));

    let rises = false;
    let falls = false;
    for (let i = 1; i < severities.length; i++) {
      if (severities[i] > severities[i - 1]) rises = true;
      if (severities[i] < severities[i - 1]) falls = true;
    }

    if (rises && falls) return 'mixed';
    return rises ? 'up' : 'down';
  }

  /**
   * range系イベント（6.3節）に、matchesが真になる効果があるか（逆引きの絞り込み用）。
   * 効果そのものを渡すので、何を尋ねるか（どのプロパティを書き換えるか・どの型を生むか）は
   * 呼び出し側が決める。
   */
  hasRangeEventMatching(matches: (declaration: EffectDeclaration) => boolean): boolean {
    return this.rangeEvents().some(([, effect]) => matches(effect));
  }

  /** 宣言されているrange系イベントとその名前（6.3節）。 */
  rangeEvents(): readonly (readonly [RangeEventLabel, EffectDeclaration])[] {
    return this.rangeEventEffects();
  }

  /** rangeEventsの、適用できる形。適用するのはこのクラス自身だけ（applyRangeEventsAt）。 */
  private rangeEventEffects(): readonly (readonly [RangeEventLabel, ActiveEffect])[] {
    const events: (readonly [RangeEventLabel, ActiveEffect])[] = [];
    if (this.onMax !== undefined) events.push(['on_max', this.onMax]);
    if (this.onMin !== undefined) events.push(['on_min', this.onMin]);
    return events;
  }

  /**
   * 著者が`on_max`/`on_min`を書いているか（6.3節）。既定のクランプしか無いプロパティはfalse。
   *
   * **端のイベントは実体値で発火する**（applyRangeEventsAt）ので、実効値が実体値と食い違いうる
   * プロパティがこれを持つと、見えている値と起きることがずれる。世界全体でその組み合わせを
   * 弾くのはWorldCodex（両方を持つのはそちらだけ）。
   */
  get hasDeclaredRangeEvent(): boolean {
    return this.hasDeclaredOnMax || this.declaredOnMin !== undefined;
  }

  /**
   * 著者が`on_max`（6.3節）を書いているか。`range`を書いただけのプロパティはfalse——上限で走るのは
   * 値を丸める既定のクランプだけで、**着いても何も起きない**。
   *
   * 「進み切ると何かが起きる値か」を上端だけについて問う口。両端のどちらでもよい問い
   * （hasDeclaredRangeEvent）とは別物で、下端のイベントしか無い値は、上限へ向かって進んでいても
   * 着いた先に何も無い。
   */
  get hasDeclaredOnMax(): boolean {
    return this.declaredOnMax !== undefined;
  }

  /** このプロパティにタグ（6.7節）が付いているか。 */
  hasTag(tagGlobalId: number): boolean {
    return this.tags.includes(tagGlobalId);
  }

  /**
   * rangeの中での値の位置（0〜1）。バー表示のための導出値で、rangeを持たないプロパティ（＝上下限が
   * 無く「満たされ具合」を定義できない）と幅0のrangeではundefinedを返す。
   */
  ratioOf(value: number): number | undefined {
    if (this.range === undefined) return undefined;
    const width = this.range.max - this.range.min;
    if (width <= 0) return undefined;
    return (this.range.clamp(value) - this.range.min) / width;
  }

  /**
   * 生成時の初期値（6.2節）。initialValueRangeを持つプロパティは[min,max]の一様乱数を1回引き、
   * 持たない場合は決定的なinitialValueWithoutRollになる。
   */
  rollInitialValue(rng: Rng): number {
    if (this.initialValueRange === undefined) return this.initialValueWithoutRoll;

    const { min, max } = this.initialValueRange;
    // nextIntの上限は排他なので+1して[min,max]の閉区間にする（max==INT32_MAXのみ桁あふれ回避）。
    return rng.nextInt(min, max === INT32_MAX ? max : max + 1);
  }

  /**
   * その値が端へ達したことで起こるrange系イベント（6.3節）の名前。達していなければ空。
   *
   * **「どちらの端に達したか」を答えるのはここだけ。** 実行時に適用する側（applyRangeEventsAt）と、
   * 実行時のオブジェクトを持たずに読む側（analysis/rangeEvents）が、同じ判定をここから引く。
   */
  rangeEventLabelsAt(value: number): readonly RangeEventLabel[] {
    return this.rangeEventsAt(value).map(([label]) => label);
  }

  private rangeEventsAt(value: number): readonly (readonly [RangeEventLabel, ActiveEffect])[] {
    const range = this.range;
    if (range === undefined) return [];

    return this.rangeEventEffects().filter(([label]) =>
      label === 'on_max' ? value >= range.max : value <= range.min,
    );
  }

  /**
   * number（変更直後の実体値）が端へ達していれば、そのイベントをowner自身へ適用する。
   *
   * 適用はowner側のadd/setNumberを通って本メソッドを再帰的に呼ぶため、1回の呼び出しの中で
   * 複数span分の溢れや繰り上げ先自身のさらなる溢れ（分→時→日の連鎖）が解決される。
   */
  applyRangeEventsAt(number: number, owner: WorldObject): void {
    for (const [, effect] of this.rangeEventsAt(number))
      owner.applyActiveEffect(effect, undefined, undefined);
  }

  /**
   * その値が該当する段（6.4節）。**「今どの段に居るか」を答えるのはここだけ**で、段の宣言から
   * 引ける事柄（alert・art・名前）は、この段を読んで得る。
   *
   * 該当する段が複数あれば**下端が最も高いもの**を採る（下限だけを書く半開区間なので、上の段ほど
   * 狭い）。下端を持たない段（完全一致、6.6節）は重ならないので、この比較に加わらない。
   * どれにも該当しなければfallbackStage。段の判定はリスト中の位置に依存しない。
   */
  stageAt(currentValue: number): PropertyStage | undefined {
    let best: PropertyStage | undefined;
    let bestBound = Number.NEGATIVE_INFINITY;

    for (const stage of this.stages) {
      if (!stage.matches(currentValue)) continue;
      const bound = stage.lowerBound ?? Number.NEGATIVE_INFINITY;
      if (best !== undefined && bound <= bestBound) continue;
      best = stage;
      bestBound = bound;
    }

    return best ?? this.fallbackStage;
  }

  /**
   * 実効値effectiveValueのとき、値がどの域にあるか（6.4節のalert）。該当する段が無い場合と、
   * 該当した段がalertを宣言していない場合は安全域。
   */
  alertOf(effectiveValue: number): AlertLevel {
    return this.stageAt(effectiveValue)?.alert ?? 'safe';
  }

  /** 実効値effectiveValueのとき、このプロパティが名前stageNameの段（6.4節）に該当しているか。 */
  isInStage(effectiveValue: number, stageName: string): boolean {
    return this.stageAt(effectiveValue)?.name === stageName;
  }

  /**
   * 実効値effectiveValueのときに該当する段を、**バーへ刻んで見せるための読み**にしたもの。
   * 該当する段が無ければundefined。名前やalertだけが要るなら段そのものを読む（stageAt）——
   * こちらは段の区間と境目を毎回組み立てる。
   */
  stageReadingAt(effectiveValue: number): CurrentStageReading | undefined {
    const stage = this.stageAt(effectiveValue);
    if (stage === undefined) return undefined;
    return { name: stage.name, span: this.spanOf(stage), boundaries: this.stageBoundaries() };
  }

  /**
   * 段の境目（rangeの中での位置、昇順）。**両端は含まない**——rangeの上下限はバーの端そのもので、
   * 刻む線を引く場所ではない。完全一致（eq）で決まる段は値の並びの上に境目を持たない。
   */
  private stageBoundaries(): readonly number[] {
    const boundaries: number[] = [];
    for (const stage of this.stages) {
      if (stage.lowerBound === undefined) continue;
      const ratio = this.ratioOf(stage.lowerBound);
      if (ratio !== undefined && ratio > 0 && ratio < 1) boundaries.push(ratio);
    }
    return boundaries.sort((a, b) => a - b);
  }

  /**
   * 段がrangeの中で占める区間（0〜1）。**下端はその段のmin**（最下段はrangeの下限）、**上端は
   * それより上で最も近い段のmin**（無ければrangeの上限）で、段の宣言順ではなくminの大小だけで決まる
   * （stageAtと同じ見方）。
   *
   * 完全一致（eq）で決まる段はシンボル型（6.6節）のもので、値の並びの上に幅を持たないためundefined。
   */
  private spanOf(stage: PropertyStage): StageSpan | undefined {
    if (this.range === undefined || this.isSymbolic) return undefined;

    const start = stage.lowerBound ?? this.range.min;
    let end = this.range.max;
    for (const other of this.stages) {
      const bound = other.lowerBound;
      if (bound !== undefined && bound > start && bound < end) end = bound;
    }

    const startRatio = this.ratioOf(start);
    const endRatio = this.ratioOf(end);
    return startRatio === undefined || endRatio === undefined
      ? undefined
      : { start: startRatio, end: endRatio };
  }

  /** stagesが宣言しているart接尾辞の一覧（重複なし、宣言順）。絵のファイル名検査（objectArt.test.ts）に使う。 */
  artSuffixes(): readonly string[] {
    return [
      ...new Set(this.stages.map((stage) => stage.art).filter((art): art is string => art !== undefined)),
    ];
  }
}

/**
 * on_max/on_min未指定時の既定動作、「自分自身をrangeの境界（isMax指定側）へsetする」効果。
 * rangeを持たないプロパティには境界が無いのでundefined。
 */
function defaultClampEffect(
  range: PropertyRange | undefined,
  propertyGlobalId: number,
  isMax: boolean,
): ActiveEffect | undefined {
  if (range === undefined) return undefined;
  return new ActiveEffectSequence([
    new SetEffect(new PropertyPath('self', propertyGlobalId), isMax ? range.max : range.min),
  ]);
}

/**
 * 端で実際に走る効果。著者が書いていなければ既定のクランプ、条件を書いていれば満たさない回だけが
 * クランプへ倒れる（RangeEventDef参照）。
 */
function rangeEventEffect(
  declared: RangeEventDef | undefined,
  clamp: ActiveEffect | undefined,
): ActiveEffect | undefined {
  if (declared === undefined) return clamp;
  if (declared.condition === undefined) return declared.effect;
  return new ConditionalEffect(declared.condition, declared.effect, clamp);
}
