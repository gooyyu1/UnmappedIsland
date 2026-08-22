import type { AlertLevel } from './AlertLevel';
import type { PropertyDef, PropertyStage, StageReading } from './PropertyDef';
import { INT32_MAX } from '../util/int32';
import { removeWhere } from '../util/arrays';
import type { RegisteredPassiveEffect } from './RegisteredPassiveEffect';
import type { WorldObject } from './WorldObject';

/**
 * props の実行時の値。数値（32bit整数、6節）のみを扱う。PassiveEffectの影響先は「プロパティ」であるため、
 * 登録済み効果の一覧・tick毎の反映・実効値の算出はWorldObjectではなくこの値自身が持つ。値の変更後のrangeイベント
 * 判定（どのon_*をいつ発火するか）は自分のPropertyDef（checkRangeEvents）へ委譲し、呼び出し側は変更後に何を
 * 判定すべきかを知らなくてよい。
 *
 * 見せ方に関わる問い（ratio・alert・stage）は実効値（8.3節）で答える。画面に出るのは「今そう見えている値」
 * であり、実体値のまま出すと、包帯を当てても痛みが下がらないように見えるため。
 */
export class PropertyValue {
  private _number: number;
  get number(): number {
    return this._number;
  }

  readonly def: PropertyDef;
  private readonly owner: WorldObject;

  /**
   * modify効果（実効値へ寄与、getEffectiveValueが走査）と積分効果（YAMLでは`add`。tick毎に実体値へ加減算、tickが走査）
   * は消費されるタイミングが異なるため別リストで持つ。
   */
  private readonly modifyEffects: RegisteredPassiveEffect[] = [];
  private readonly accumulateEffects: RegisteredPassiveEffect[] = [];

  /**
   * getEffectiveValueの再入検出用。modifyのconditions（14節）が実効値を読むため、自分自身の実効値へ
   * （直接・間接に）依存する循環参照が起こりうる。放置すると制御不能なスタックオーバーフローになるため、
   * 再入検出時点で分かりやすいエラーを投げる。
   */
  private isComputingEffectiveValue = false;

  /** 初期値は定義が決める（PropertyDef.rollInitialValue、6.2節）。抽選つきの宣言があるので乱数源が要る。 */
  constructor(def: PropertyDef, owner: WorldObject) {
    this._number = def.rollInitialValue(owner.session.rng);
    this.def = def;
    this.owner = owner;
  }

  /**
   * **まだ世界のルールを走らせてはいけない時点で**値を置く。登録済みのincoming（modify/add）は
   * そのまま、値の中身だけを差し替え、rangeイベント（6.3節）もgainの記録（PropertyGain）も行わない。
   *
   * 途中の状態が世界から見えてはいけない場面のための入口:
   *
   * - 型が変わったときの値の引き継ぎ（becomeType、9.9節）。passiveの登録もスタックの再判定も
   *   まだ済んでおらず、ここで起きた効果は組み立て途中のオブジェクトを見ることになる。
   *   引き継ぎをaddへ寄せられない理由はもう1つあって、becomeは操作の効果の中から走るため、
   *   引き継いだ値がそのままプレイヤーの稼ぎとして記録されてしまう。
   * - 生成が書き込む行き先ID（IslandSpawner）。両端の道が互いを指し終えるまで、片側だけを
   *   指した状態は世界として成立していない。
   * - シナリオが用意する開始値。水を置く前に水分を0にした瞬間に渇きで死ぬ、という順序依存を
   *   持ち込まない。
   *
   * **出来上がったオブジェクトの値を動かすのには使わない。** そちらは add / setNumber で、
   * rangeイベントもgainも通常どおり働く。
   */
  init(number: number): void {
    this._number = number;
  }

  /**
   * 数値を加減算し（不可逆）、値が変わった直後にon_max・on_min（6.3節）の判定を自分で行う。
   * **どこから呼ばれても判定は走る**ので、呼び出し側は変更後に何をすべきかを覚えなくてよい。
   *
   * deltaが0の場合は何もしない。on_max等の既定の補正（rangeの境界へのset）が境界に着地した後の再setで、
   * add→checkRangeEvents→applyActiveEffect→setNumber→addが無限に連鎖するのを防ぐガード。
   */
  add(delta: number): void {
    if (delta === 0) return;

    this._number += delta;

    // 操作が直に動かした値はここだけを通る（毎tickの積分はtick()が直に足す、PropertyGain参照）。
    this.owner.session.recordGain(this.owner, this.def, delta);
    this.def.checkRangeEvents(this._number, this.owner);
  }

  /** 絶対値代入（set）。差分をaddへ委譲するため、range判定はadd側に一本化される。 */
  setNumber(value: number): void {
    this.add(value - this._number);
  }

  /** modify効果としての登録先（PropertyPassiveEffect.registerInto経由でのみ呼ばれる想定）。 */
  registerModify(effect: RegisteredPassiveEffect): void {
    this.modifyEffects.push(effect);
  }

  /** 積分効果（YAMLでは`add`）としての登録先（PropertyPassiveEffect.registerInto経由でのみ呼ばれる想定）。 */
  registerAccumulate(effect: RegisteredPassiveEffect): void {
    this.accumulateEffects.push(effect);
  }

  unregisterPassiveEffectsFrom(declarer: WorldObject): void {
    removeWhere(this.modifyEffects, (c) => c.declarer === declarer);
    removeWhere(this.accumulateEffects, (c) => c.declarer === declarer);
  }

  /** 現在登録されている全寄与（modify/add両方）。UI表示用。 */
  get incoming(): readonly RegisteredPassiveEffect[] {
    return [...this.modifyEffects, ...this.accumulateEffects];
  }

  /**
   * modifyとinherit（祖先からの継承）を加味した実効値（8.3節）。可逆な寄与であり、実体値そのものは書き換えない。
   * conditions（14節）がこの実効値を読むため再入（循環参照）が起こりうる。isComputingEffectiveValueで検出し、
   * スタックオーバーフローになる前にエラーを投げる。
   */
  getEffectiveValue(): number {
    if (this.isComputingEffectiveValue) {
      throw new Error(
        `プロパティ'${this.def.name}'の実効値計算中に循環参照を検出しました` +
          '（modifyのconditionsが、直接・間接を問わず自分自身の実効値に依存しています）。',
      );
    }

    this.isComputingEffectiveValue = true;
    try {
      let sum = this._number;

      for (const c of this.modifyEffects) sum += c.activeAmount();

      sum += this.def.inheritedContribution(this.owner);

      // weight/load は中身から寄与を受ける（ContainerSystem.md 1〜2節）。他のプロパティでは0。
      sum += this.owner.containerContributionTo(this.def.globalId);

      return this.def.range !== undefined ? this.def.range.clamp(sum) : sum;
    } finally {
      this.isComputingEffectiveValue = false;
    }
  }

  /**
   * passivesの`add`を実体値へ加減算し（8.4節、不可逆）、rangeイベント（6.3節）を判定する。
   * 1tickにつき1回、WorldObject.tick経由で呼ばれる想定。
   */
  tick(): void {
    for (const c of this.accumulateEffects) this._number += c.activeAmount();

    this.def.checkRangeEvents(this._number, this.owner);
  }

  /**
   * 今tickこの値へ入る`add`の合計（8.4節）。0なら、この値は今のところ動かない。
   *
   * tickが足すのと同じ寄与を、足さずに数えたもの。**この場で結果を見に行かずに、これから何が
   * 起きるかを言える唯一の手掛かり**で、値の出入り（WorldChange）には現れない。
   */
  private changePerTick(): number {
    let sum = 0;
    for (const c of this.accumulateEffects) sum += c.activeAmount();
    return sum;
  }

  /**
   * 今の進み方が続いたとき、あと何tickでrange.maxへ届く（on_maxが起きる、6.3節）か。
   * 進んでいない（合計が0以下）・rangeを持たない場合はundefined。
   */
  ticksUntilMax(): number | undefined {
    const range = this.def.range;
    if (range === undefined) return undefined;

    const perTick = this.changePerTick();
    if (perTick <= 0) return undefined;
    return Math.max(1, Math.ceil((range.max - this._number) / perTick));
  }

  /** 今まさに指定した名前のstage（6.4節）に該当しているか（WhenOwnStageゲート専用、8節）。 */
  isInStage(stageName: string): boolean {
    return this.stage?.name === stageName;
  }

  /**
   * 今いる段（6.4節）。段を宣言していない・どれにも該当しないならundefined。**段から引ける事柄
   * （alert・art・名前）は、この1つを読んで得る。**
   *
   * 生の値ではなく実効値で引く（modifyだけで決まる派生プロパティ自身のstagesも判定できるように
   * するため）。
   */
  get stage(): PropertyStage | undefined {
    return this.def.stageAt(this.getEffectiveValue());
  }

  /** 今の実効値が該当する段（6.4節）が宣言しているart接尾辞（`art_by_stage`専用）。宣言が無ければundefined。 */
  get artSuffix(): string | undefined {
    return this.stage?.art;
  }

  /**
   * 値が尽きたまま残っているなら（PropertyDef.isExhausted）、今居る段（6.4節）の名前。
   * 尽きていないか、該当する段が無ければundefined。
   *
   * 尽きた瞬間に自分を消すプロパティ（on_minのdestroy、6.3節）は既定のクランプを持たないため、
   * 尽きた値のまま静止する。「何が尽きたのか」はそこから読める。
   */
  get exhaustedStage(): string | undefined {
    return this.def.isExhausted(this._number) ? this.stage?.name : undefined;
  }

  /** rangeの中での位置（0〜1）。rangeを持たないプロパティはundefinedで、バーではなく数値で見せる。 */
  get ratio(): number | undefined {
    return this.def.ratioOf(this.getEffectiveValue());
  }

  /** 今の値がどの域にあるか（6.4節のalert）。出すか・明滅させるかの判断はUI側（StatusArea.md 2節）。 */
  get alert(): AlertLevel {
    return this.def.alertOf(this.getEffectiveValue());
  }

  /** 今いる段を、バーへ刻んで見せるための読み（6.4節）。段を宣言していないプロパティはundefined。 */
  get stageOnBar(): StageReading | undefined {
    return this.def.stageOnBarAt(this.getEffectiveValue());
  }

  /** transfer（9.5節）でこのプロパティから出せる量の上限。rangeがあればrange.minを下限とみなし、無ければ現在値そのまま。 */
  availableToTransferOut(): number {
    return this.def.range !== undefined ? Math.max(0, this._number - this.def.range.min) : this._number;
  }

  /** transfer（9.5節）でallow_overflow: falseの場合に受け取れる量の上限。rangeが無ければ上限なし。 */
  remainingTransferCapacity(): number {
    return this.def.range !== undefined ? Math.max(0, this.def.range.max - this._number) : INT32_MAX;
  }

  toString(): string {
    return String(this._number);
  }
}
