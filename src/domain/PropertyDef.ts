import type { WorldObject } from './WorldObject';
import type { WorldSession } from './WorldSession';
import type { Rng } from './Rng';
import { INT32_MAX } from '../util/int32';
import type { ActiveEffect } from './ActiveEffect';
import { describeEffect } from './describeEffect';
import type { EffectDeclaration } from './EffectReader';
import type { AlertLevel } from './AlertLevel';
import { ALERT_LEVELS } from './AlertLevel';
import type { DefNames, DescriptionToken, DescriptionWriter } from './Description';
import { propertyTagRef, stageRef, text } from './Description';

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
    if (value < this.min) return this.min;
    if (value > this.max) return this.max;
    return value;
  }
}

/**
 * 6.4節の stages の1段。minとeqはいずれか一方のみ有効（ロード時に両方の指定を拒否する）。
 * min: 下限のみの半開区間（数値プロパティ向け）。eq: 完全一致判定（シンボル型プロパティ（6.6節）向け）。
 * どちらも未指定ならフォールバック段（どの段にも該当しない場合の受け皿、6.4節）。
 */
export class PropertyStage {
  readonly name: string;

  /** 下限。undefinedは最下段（それより下の残り全ての値を拾う、6.4節）、またはeq指定時。 */
  readonly min: number | undefined;

  /** 完全一致判定の対象値。undefinedは未指定（minまたはフォールバックとして扱う）。 */
  readonly eq: number | undefined;

  /** この段にいる間、値がどの域にあると見なすか（6.4節のalert）。 */
  readonly alert: AlertLevel;

  /**
   * この段にいる間カードに出す絵の接尾辞（`art_by_stage`、6.4節）。`src/assets/objects/
   * <object_defの識別子>_<この値>.png` を指す。宣言しない段はundefinedで、その型の絵のまま。
   */
  readonly art: string | undefined;

  constructor(name: string, min: number | undefined, eq?: number, alert: AlertLevel = 'safe', art?: string) {
    this.name = name;
    this.min = min;
    this.eq = eq;
    this.alert = alert;
    this.art = art;
  }

  /** この段を書き表す（Description参照）。propertyGlobalIdは、eqの値をシンボル名へ戻すために要る。 */
  describe(names: DefNames, propertyGlobalId: number): readonly DescriptionToken[] {
    const tokens: DescriptionToken[] = [stageRef(this.name)];
    if (this.eq !== undefined) {
      // シンボル型の段は、段の名前がそのまま比較する値（6.4節）。同じ名前を二度書かない。
      const value = names.propertyValue(propertyGlobalId, this.eq);
      if (value.kind !== 'symbol' || value.name !== this.name) tokens.push(text(': '), value, text('のとき'));
    } else if (this.min !== undefined) tokens.push(text(`: ${this.min}以上`));
    else tokens.push(text(': どの段にも該当しないとき'));

    if (this.alert !== 'safe') tokens.push(text(`（alert: ${this.alert}）`));
    if (this.art !== undefined) tokens.push(text(`（art: ${this.art}）`));
    return tokens;
  }
}

/** range系イベント（6.3節）の名前。 */
export type RangeEventLabel = 'on_overflow' | 'on_shortfall';

/** 段（6.4節）がrangeの中で占める区間。両端とも0〜1で、startがminの側。 */
export interface StageSpan {
  readonly start: number;
  readonly end: number;
}

/**
 * 段（6.4節）の刻みと、その中で今どこにいるか（PropertyDef.stageOf）。
 * nameは識別子であり表示名ではない（表示名はLocalization.stageが引く）。
 */
export interface StageReading {
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

  /** 初期値（スカラー）。initialValueRangeを持つ場合は、RNGを使わない生成でのフォールバック（= range.min）。 */
  readonly initialValue: number;

  /** value: {min, max} 記法による初期値のランダム範囲（6.2節、rollInitialValue参照）。無ければundefined。 */
  private readonly initialValueRange: PropertyRange | undefined;

  /** 生成時に1回ロールされる初期値を持つか（6.2節）。量的オブジェクトでは禁止（7.6節）。 */
  get hasInitialValueRoll(): boolean {
    return this.initialValueRange !== undefined;
  }

  /** 取りうる値域（6.3節）。on_overflow/on_shortfallを使う場合は必須。使わない場合はundefined。 */
  readonly range: PropertyRange | undefined;

  /**
   * on_overflow（6.3節）: 値がrange.maxを超えた際にselfへ一度だけ適用するactive内容。対象プロパティは
   * 自分自身（折り返し）でも他のプロパティ（繰り上げ先）でも構わない。rangeが定義されていて著者が
   * 明示的に書かなかった場合、「自分自身をrange.maxへsetする」既定のActiveEffectがビルド時に自動生成
   * されて入る（WorldCodexYamlLoaderのプロパティ解析参照）。range自体が未定義の場合のみundefined。
   */
  private readonly onOverflow: ActiveEffect | undefined;

  /**
   * on_shortfall（6.3節）: on_overflowの下限側の鏡像。値がrange.minを下回った際にselfへ一度だけ適用する。
   * 未記述時は「自分自身をrange.minへsetする」既定が自動生成される。range未定義の場合のみundefined。
   */
  private readonly onShortfall: ActiveEffect | undefined;

  /** 順不同で構わない（resolveStage が min の値そのもので判定するため）。空なら stages なし。 */
  private readonly stages: readonly PropertyStage[];

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
   * inherit: 同名プロパティを定義している最初の祖先（findAncestorWithProperty）の実効値を、自分の
   * 実効値に加算するか。祖先が見つからなければ寄与0。parentではなくancestorなのは、直接の親が
   * このプロパティを持たない場合に備えるため（例: ambient_temperatureは部屋が持つ）。
   */
  readonly inherit: boolean;

  /**
   * このプロパティに付いたタグのグローバルIDの一覧（6.7節）。object_defのタグ（4.1節）とは別の
   * 名前空間で、UIがプロパティをカテゴリ別にまとめるために使う。
   */
  readonly tags: readonly number[];

  /**
   * 値がシンボル（6.6節。天気の`clear`、季節の`dry`）か。実行時の値は数値なので、シンボル名へ
   * 戻せるかどうかはこの宣言だけが知っている（`WorldCodex.propertyValue`が使う）。
   */
  readonly isSymbolic: boolean;

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
    onOverflow: ActiveEffect | undefined,
    stages: readonly PropertyStage[],
    onShortfall?: ActiveEffect,
    inherit = false,
    tags: readonly number[] = [],
    isSymbolic = false,
    gauge: GaugeDef | undefined = undefined,
  ) {
    this.globalId = globalId;
    this.name = name;
    this.initialValue = initialValue;
    this.initialValueRange = initialValueRange;
    this.range = range;
    this.onOverflow = onOverflow;
    this.stages = stages;
    this.onShortfall = onShortfall;
    this.inherit = inherit;
    this.tags = tags;
    this.isSymbolic = isSymbolic;
    this.gauge = gauge;

    this.fallbackStage = stages.find((stage) => stage.eq === undefined && stage.min === undefined);
    this.alertDirection = PropertyDef.deriveAlertDirection(stages);
    this.hasStageArt = stages.some((stage) => stage.art !== undefined);
  }

  /**
   * 数値の段を下から上へ並べ、alertの深刻さがどちらへ動くかを見る（シンボル型の段は大小関係を持たない
   * ため除く）。単調に上がるならup、単調に下がるならdown、どちらでもなければmixed。
   * 深刻さが動かない（段が無い・全段が同じ域）場合は、満タンが良いという既定に合わせてdown。
   */
  private static deriveAlertDirection(stages: readonly PropertyStage[]): AlertDirection {
    const severities = stages
      .filter((stage) => stage.eq === undefined)
      .sort((a, b) => (a.min ?? Number.NEGATIVE_INFINITY) - (b.min ?? Number.NEGATIVE_INFINITY))
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
   * 初期値の書き表し（Description参照）。一覧の表など、1行で済ませたい場所向けに断片で返す。
   */
  describeInitialValue(names: DefNames): readonly DescriptionToken[] {
    if (this.initialValueRange !== undefined)
      return [text(`${this.initialValueRange.min}〜${this.initialValueRange.max}（生成時に1回抽選）`)];
    return [names.propertyValue(this.globalId, this.initialValue)];
  }

  /** このプロパティの定義を書き出す（Description参照）。 */
  describe(names: DefNames, out: DescriptionWriter): void {
    out.write(text('初期値: '), ...this.describeInitialValue(names));
    if (this.range !== undefined) out.write(text(`range: ${this.range.min} 〜 ${this.range.max}`));
    if (this.inherit) out.write(text('inherit: 同名プロパティを持つ最初の祖先の実効値を足す'));
    if (this.gauge !== undefined)
      out.write(text(`gauge: min=${this.gauge.atMin} / max=${this.gauge.atMax}（カードにバーで出す）`));
    if (this.tags.length > 0)
      out.write(
        text('tags: '),
        ...this.tags.map((tagGlobalId) => propertyTagRef(names.propertyTagName(tagGlobalId))),
      );

    if (this.stages.length > 0) {
      out.write(text('stages:'));
      out.indented(() => {
        for (const stage of this.stages) out.write(...stage.describe(names, this.globalId));
      });
    }

    this.describeRangeEvent('on_overflow', this.onOverflow, names, out);
    this.describeRangeEvent('on_shortfall', this.onShortfall, names, out);
  }

  private describeRangeEvent(
    label: string,
    effect: ActiveEffect | undefined,
    names: DefNames,
    out: DescriptionWriter,
  ): void {
    if (effect === undefined) return;
    out.write(text(`${label}:`));
    out.indented(() => describeEffect(effect, names, out));
  }

  /**
   * range系イベント（6.3節）に、matchesが真になる効果があるか（逆引きの絞り込み用）。
   * 効果そのものを渡すので、何を尋ねるか（どのプロパティを書き換えるか・どの型を生むか）は
   * 呼び出し側が決める。
   */
  hasRangeEventMatching(matches: (declaration: EffectDeclaration) => boolean): boolean {
    return this.rangeEvents().some(([, effect]) => matches(effect));
  }

  /** range系イベントのうち、matchesが真になるものだけを書き出す。 */
  describeRangeEventsMatching(
    matches: (declaration: EffectDeclaration) => boolean,
    names: DefNames,
    out: DescriptionWriter,
  ): void {
    for (const [label, effect] of this.rangeEvents())
      if (matches(effect)) this.describeRangeEvent(label, effect, names, out);
  }

  /** 宣言されているrange系イベントとその名前（6.3節）。 */
  rangeEvents(): readonly (readonly [RangeEventLabel, ActiveEffect])[] {
    const events: (readonly [RangeEventLabel, ActiveEffect])[] = [];
    if (this.onOverflow !== undefined) events.push(['on_overflow', this.onOverflow]);
    if (this.onShortfall !== undefined) events.push(['on_shortfall', this.onShortfall]);
    return events;
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
   * 持たない場合は決定的なinitialValueになる。
   */
  rollInitialValue(rng: Rng): number {
    if (this.initialValueRange === undefined) return this.initialValue;

    const { min, max } = this.initialValueRange;
    // nextIntの上限は排他なので+1して[min,max]の閉区間にする（max==INT32_MAXのみ桁あふれ回避）。
    return rng.nextInt(min, max === INT32_MAX ? max : max + 1);
  }

  /**
   * number（変更直後の実体値）に対してon_overflow・on_shortfall（6.3節）を判定し、該当するものを
   * owner自身へ適用する。rangeが未定義なら何もしない。
   *
   * 適用はowner側のadd/setNumberを通って本メソッドを再帰的に呼ぶため、1回の呼び出しの中で
   * 複数span分の溢れや繰り上げ先自身のさらなる溢れ（分→時→日の連鎖）が解決される。
   */
  checkRangeEvents(number: number, owner: WorldObject, session: WorldSession): void {
    if (this.range === undefined) return;
    const range = this.range;

    if (this.onOverflow !== undefined && number > range.max)
      owner.applyActiveEffect(this.onOverflow, session, undefined, undefined);

    if (this.onShortfall !== undefined && number < range.min)
      owner.applyActiveEffect(this.onShortfall, session, undefined, undefined);
  }

  /**
   * 現在値が該当する段階を返す。eq指定（完全一致、一致した時点で即返してよい）が優先、次にmin指定
   * （最も高いminを採用するため全段を走査）、どちらも該当しなければfallbackStage（6.4節）。
   * 段の判定はリスト中の位置に依存しない。fallbackが無ければundefinedを返し得るため、
   * 呼び出し側（isInStage等）は常にundefinedチェックする前提。
   */
  private resolveStage(currentValue: number): PropertyStage | undefined {
    let best: PropertyStage | undefined;

    for (const stage of this.stages) {
      if (stage.eq !== undefined) {
        if (currentValue === stage.eq) return stage;
        continue;
      }
      if (
        stage.min !== undefined &&
        currentValue >= stage.min &&
        (best === undefined || stage.min > best.min!)
      )
        best = stage;
    }

    return best ?? this.fallbackStage;
  }

  /**
   * 実効値effectiveValueのとき、値がどの域にあるか（6.4節のalert）。該当する段が無い場合と、
   * 該当した段がalertを宣言していない場合は安全域。
   */
  alertLevelOf(effectiveValue: number): AlertLevel {
    return this.resolveStage(effectiveValue)?.alert ?? 'safe';
  }

  /** 実効値effectiveValueのとき、このプロパティが名前stageNameの段（6.4節）に該当しているか。 */
  isInStage(effectiveValue: number, stageName: string): boolean {
    const stage = this.resolveStage(effectiveValue);
    return stage !== undefined && stage.name === stageName;
  }

  /** 実効値effectiveValueのときに該当する段（6.4節）の名前。該当する段が無ければundefined。 */
  stageNameOf(effectiveValue: number): string | undefined {
    return this.resolveStage(effectiveValue)?.name;
  }

  /**
   * 実効値effectiveValueのときに該当する段（6.4節）を、表示側が要る形だけ切り出したもの。
   * 該当する段が無ければundefined。
   */
  stageOf(effectiveValue: number): StageReading | undefined {
    const stage = this.resolveStage(effectiveValue);
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
      if (stage.min === undefined || stage.eq !== undefined) continue;
      const ratio = this.ratioOf(stage.min);
      if (ratio !== undefined && ratio > 0 && ratio < 1) boundaries.push(ratio);
    }
    return boundaries.sort((a, b) => a - b);
  }

  /**
   * 段がrangeの中で占める区間（0〜1）。**下端はその段のmin**（最下段はrangeの下限）、**上端は
   * それより上で最も近い段のmin**（無ければrangeの上限）で、段の宣言順ではなくminの大小だけで決まる
   * （resolveStageと同じ見方）。
   *
   * 完全一致（eq）で決まる段はシンボル型（6.6節）のもので、値の並びの上に幅を持たないためundefined。
   */
  private spanOf(stage: PropertyStage): StageSpan | undefined {
    if (this.range === undefined || stage.eq !== undefined) return undefined;

    const start = stage.min ?? this.range.min;
    let end = this.range.max;
    for (const other of this.stages)
      if (other.min !== undefined && other.min > start && other.min < end) end = other.min;

    const startRatio = this.ratioOf(start);
    const endRatio = this.ratioOf(end);
    return startRatio === undefined || endRatio === undefined
      ? undefined
      : { start: startRatio, end: endRatio };
  }

  /** 実効値effectiveValueのとき、今いる段が宣言しているart接尾辞（PropertyStage.art、6.4節）。宣言が無ければundefined。 */
  artSuffixOf(effectiveValue: number): string | undefined {
    return this.resolveStage(effectiveValue)?.art;
  }

  /** stagesが宣言しているart接尾辞の一覧（重複なし、宣言順）。絵のファイル名検査（objectArt.test.ts）に使う。 */
  artSuffixes(): readonly string[] {
    return [
      ...new Set(this.stages.map((stage) => stage.art).filter((art): art is string => art !== undefined)),
    ];
  }

  /** 実体値numberがrangeの下限を割っているか（rangeを持たないプロパティでは常に偽）。 */
  isBelowRange(number: number): boolean {
    return this.range !== undefined && number < this.range.min;
  }

  /** inherit（6節）による、祖先からownerの実効値へ加える寄与。inheritが無効、または該当する祖先が見つからない場合は0。 */
  inheritedContribution(owner: WorldObject): number {
    if (!this.inherit) return 0;
    const ancestor = owner.findAncestorWithProperty(this.globalId);
    return ancestor !== undefined ? ancestor.getEffectiveValue(this.globalId) : 0;
  }
}
