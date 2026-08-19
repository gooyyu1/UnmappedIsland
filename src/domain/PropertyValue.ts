import type { AlertLevel } from './AlertLevel';
import type { GaugeDef, PropertyDef, StageReading } from './PropertyDef';
import { INT32_MAX } from '../util/int32';
import { removeWhere } from '../util/arrays';
import type { RegisteredPassiveEffect } from './RegisteredPassiveEffect';
import type { Rng } from './Rng';
import type { WorldObject } from './WorldObject';
import type { WorldSession } from './WorldSession';

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

  private readonly def: PropertyDef;
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
  constructor(def: PropertyDef, owner: WorldObject, rng: Rng) {
    this._number = def.rollInitialValue(rng);
    this.def = def;
    this.owner = owner;
  }

  /** setProperty用。登録済みのincomingはそのまま、値の中身だけを差し替える。 */
  copyValueFrom(number: number): void {
    this._number = number;
  }

  /**
   * 数値を加減算し（不可逆）、値が変わった直後にon_overflow・on_shortfall（6.3節）の判定を行う。
   *
   * sessionが未指定の場合は判定を行わない（呼び出し側が後で明示的にtick()を呼んで判定させる場合。
   * WorldObject.addNumber参照）。
   *
   * deltaが0の場合は何もしない。on_overflow等の既定の補正（rangeの境界へのset）が境界に着地した後の再setで、
   * add→checkRangeEvents→applyActiveEffect→setNumber→addが無限に連鎖するのを防ぐガード。
   */
  add(delta: number, session: WorldSession | undefined): void {
    if (delta === 0) return;

    this._number += delta;
    if (session === undefined) return;

    // 操作が直に動かした値はここだけを通る（毎tickの積分はtick()が直に足す、PropertyGain参照）。
    session.recordGain(this.owner, this.def, delta);
    this.def.checkRangeEvents(this._number, this.owner, session);
  }

  /** 絶対値代入（set）。差分をaddへ委譲するため、range判定はadd側に一本化される。 */
  setNumber(value: number, session: WorldSession | undefined): void {
    this.add(value - this._number, session);
  }

  /**
   * 効果を登録する。modify用/積分用のどちらのリストへ入るかは効果自身が決めてregisterModify/
   * registerAccumulateを呼び分ける。
   */
  registerPassiveEffect(effect: RegisteredPassiveEffect): void {
    effect.registerInto(this);
  }

  /** modify効果としての登録先（RegisteredPassiveEffect.registerInto経由でのみ呼ばれる想定）。 */
  registerModify(effect: RegisteredPassiveEffect): void {
    this.modifyEffects.push(effect);
  }

  /** 積分効果（YAMLでは`add`）としての登録先（RegisteredPassiveEffect.registerInto経由でのみ呼ばれる想定）。 */
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
  tick(session: WorldSession): void {
    for (const c of this.accumulateEffects) this._number += c.activeAmount();

    this.def.checkRangeEvents(this._number, this.owner, session);
  }

  /**
   * 今tickこの値へ入る`add`の合計（8.4節）。0なら、この値は今のところ動かない。
   *
   * tickが足すのと同じ寄与を、足さずに数えたもの。**この場で結果を見に行かずに、これから何が
   * 起きるかを言える唯一の手掛かり**で、値の出入り（WorldChange）には現れない。
   */
  changePerTick(): number {
    let sum = 0;
    for (const c of this.accumulateEffects) sum += c.activeAmount();
    return sum;
  }

  /**
   * 今の進み方が続いたとき、あと何tickでrange.maxを超える（on_overflowが起きる、6.3節）か。
   * 進んでいない（合計が0以下）・rangeを持たない場合はundefined。
   *
   * 溢れは`> max`で起きるので、maxちょうどに乗ったtickではまだ起きない——**maxへ届く回ではなく、
   * その次の回**が答えになる。
   */
  ticksUntilOverflow(): number | undefined {
    const range = this.def.range;
    if (range === undefined) return undefined;

    const perTick = this.changePerTick();
    if (perTick <= 0) return undefined;
    return Math.max(1, Math.floor((range.max - this._number) / perTick) + 1);
  }

  /**
   * 今まさに指定した名前のstage（6.4節）に該当しているか（WhenOwnStageゲート専用、8節）。生の値ではなく
   * 実効値で判定する（modifyだけで決まる派生プロパティ自身のstagesも判定できるようにするため）。
   */
  isInStage(stageName: string): boolean {
    return this.def.isInStage(this.getEffectiveValue(), stageName);
  }

  /** 今の実効値が該当する段（6.4節）が宣言しているart接尾辞（`art_by_stage`専用）。宣言が無ければundefined。 */
  artSuffix(): string | undefined {
    return this.def.artSuffixOf(this.getEffectiveValue());
  }

  /**
   * 値がrangeの下限を割ったまま残っているなら、今居る段（6.4節）の名前。範囲の中にあるか、
   * 該当する段が無ければundefined。
   *
   * 尽きた瞬間に自分を消すプロパティ（on_shortfallのdestroy、6.3節）は既定のクランプを持たないため、
   * 尽きた値のまま静止する。「何が尽きたのか」はそこから読める。
   */
  exhaustedStage(): string | undefined {
    if (!this.def.isBelowRange(this._number)) return undefined;
    return this.def.stageNameOf(this.getEffectiveValue());
  }

  /** このプロパティの識別子。表示名ではない（表示名はLocalizationが引く）。 */
  get name(): string {
    return this.def.name;
  }

  /** rangeの中での位置（0〜1）。rangeを持たないプロパティはundefinedで、バーではなく数値で見せる。 */
  get ratio(): number | undefined {
    return this.def.ratioOf(this.getEffectiveValue());
  }

  /** 今の値がどの域にあるか（6.4節のalert）。出すか・明滅させるかの判断はUI側（StatusArea.md 2節）。 */
  get alert(): AlertLevel {
    return this.def.alertLevelOf(this.getEffectiveValue());
  }

  /** 増えるほど悪い値か。ゲージを持つなら、帯の向きもゲージの宣言（両端の見せ方）が決める。 */
  get worsensUpward(): boolean {
    return this.def.gauge?.worsensUpward ?? this.def.worsensUpward;
  }

  /**
   * カードのゲージとして見せる宣言（6.8節）。持たないプロパティはundefinedで、カードにバーが出ない。
   * 出すかどうかも両端の色も、この1つが決める（docs/ui/CardView.md 8節）。
   */
  get gauge(): GaugeDef | undefined {
    return this.def.gauge;
  }

  /** 今いる段（6.4節）。段を宣言していないプロパティはundefined。 */
  get stage(): StageReading | undefined {
    return this.def.stageOf(this.getEffectiveValue());
  }

  /** タグ（6.7節）が付いているか。 */
  hasTag(tagGlobalId: number): boolean {
    return this.def.hasTag(tagGlobalId);
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
