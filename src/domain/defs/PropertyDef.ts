import { PropertyValue } from '../runtime/PropertyValue';
import type { WorldObject } from '../runtime/WorldObject';
import type { WorldSession } from '../runtime/WorldSession';
import { INT32_MAX } from '../../util/int32';
import type { ActiveEffect } from './ActiveEffect';
import type { AlertLevel } from './AlertLevel';
import { ALERT_LEVELS } from './AlertLevel';

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

  constructor(name: string, min: number | undefined, eq?: number, alert: AlertLevel = 'safe') {
    this.name = name;
    this.min = min;
    this.eq = eq;
    this.alert = alert;
  }
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
  private readonly initialValue: number;

  /** value: {min, max} 記法による初期値のランダム範囲（6.2節、createValue参照）。無ければundefined。 */
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

  /**
   * 値が増えるほど悪いプロパティか（負荷など）。**専用の宣言は持たず、`stages`のalertから導く**:
   * 最も上の段が最も下の段より深刻なら、増える側が悪い。「どちらが危ないか」は既にalertが宣言して
   * いるので、同じことを二度書かせない（両端が同じ深刻さの段なら、既定の「減ると悪い」のまま）。
   *
   * 見せ方（バーの向き・増減の記号の色）だけがこれを見る（ScreenLayout.md ステータスエリア節）。
   */
  readonly worsensUpward: boolean;

  /**
   * inherit: 同名プロパティを定義している最初の祖先（findAncestorWithProperty）の実効値を、自分の
   * 実効値に加算するか。祖先が見つからなければ寄与0。parentではなくancestorなのは、直接の親が
   * このプロパティを持たない場合に備えるため（例: ambient_temperatureは部屋が持つ）。
   */
  private readonly inherit: boolean;

  /**
   * このプロパティに付いたタグのグローバルIDの一覧（6.7節）。object_defのタグ（4.1節）とは別の
   * 名前空間で、UIがプロパティをカテゴリ別にまとめるために使う。
   */
  readonly tags: readonly number[];

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

    this.fallbackStage = stages.find((stage) => stage.eq === undefined && stage.min === undefined);
    this.worsensUpward = PropertyDef.derivesWorsensUpward(stages);
  }

  /** 数値の段を下から上へ並べ、両端のalertの深刻さを比べる（段が2つ未満・シンボル型の段では常に偽）。 */
  private static derivesWorsensUpward(stages: readonly PropertyStage[]): boolean {
    const ordered = stages
      .filter((stage) => stage.eq === undefined)
      .sort((a, b) => (a.min ?? Number.NEGATIVE_INFINITY) - (b.min ?? Number.NEGATIVE_INFINITY));
    if (ordered.length < 2) return false;

    const severity = (stage: PropertyStage): number => ALERT_LEVELS.indexOf(stage.alert);
    return severity(ordered[ordered.length - 1]) > severity(ordered[0]);
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
   * このプロパティ定義に属する、新しい実行時値（PropertyValue）を生成する。initialValueRangeを持つ
   * プロパティは初期値を[min,max]の一様乱数（session.rng）に、持たない場合は決定的なinitialValueにする（6.2節）。
   */
  createValue(owner: WorldObject, session: WorldSession): PropertyValue {
    let initial = this.initialValue;
    if (this.initialValueRange !== undefined) {
      const { min, max } = this.initialValueRange;
      // nextIntの上限は排他なので+1して[min,max]の閉区間にする（max==INT32_MAXのみ桁あふれ回避）。
      initial = session.rng.nextInt(min, max === INT32_MAX ? max : max + 1);
    }
    return new PropertyValue(initial, this, owner);
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

  /** inherit（6節）による、祖先からownerの実効値へ加える寄与。inheritが無効、または該当する祖先が見つからない場合は0。 */
  inheritedContribution(owner: WorldObject): number {
    if (!this.inherit) return 0;
    const ancestor = owner.findAncestorWithProperty(this.globalId);
    return ancestor !== undefined ? ancestor.getEffectiveValue(this.globalId) : 0;
  }
}
