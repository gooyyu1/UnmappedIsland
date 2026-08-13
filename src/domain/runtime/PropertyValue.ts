import type { AlertLevel } from '../defs/AlertLevel';
import type { PropertyDef } from '../defs/PropertyDef';
import { INT32_MAX } from '../../util/int32';
import { removeWhere } from '../../util/arrays';
import type { RegisteredPassiveEffect } from './RegisteredPassiveEffect';
import type { WorldObject } from './WorldObject';
import type { WorldSession } from './WorldSession';

/**
 * 1つのプロパティの現在の状態を、表示側が必要とする形だけ切り出したもの（PropertyValue.readIfTagged）。
 * nameは識別子であり表示名ではない（表示名はLocalizationが引く）。
 */
export interface PropertyReading {
  readonly name: string;
  readonly value: number;

  /** rangeの中での位置（0〜1）。rangeを持たないプロパティはundefinedで、バーではなく数値で見せる。 */
  readonly ratio: number | undefined;

  /** 今の値がどの域にあるか（6.4節のalert）。表示するか・明滅させるかの判断はUI側（StatusArea.md 2節）。 */
  readonly alert: AlertLevel;

  /** 増えるほど悪い値か（PropertyDef.worsensUpward）。バーの向きと増減の記号の色だけがこれを見る。 */
  readonly worsensUpward: boolean;
}

/**
 * props の実行時の値。数値（32bit整数、6節）のみを扱う。PassiveEffectの影響先は「プロパティ」であるため、
 * 登録済み効果の一覧・tick毎の反映・実効値の算出はWorldObjectではなくこの値自身が持つ。値の変更後のrangeイベント
 * 判定（どのon_*をいつ発火するか）は自分のPropertyDef（checkRangeEvents）へ委譲し、呼び出し側は変更後に何を
 * 判定すべきかを知らなくてよい。
 */
export class PropertyValue {
  private _number: number;
  get number(): number {
    return this._number;
  }

  private readonly def: PropertyDef;
  private readonly owner: WorldObject;

  /**
   * modify効果（実効値へ寄与、getEffectiveValueが走査）とaccumulate効果（tick毎に実体値へ加減算、tickが走査）
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

  /** 生成はPropertyDef.createValueが担う（初期値numberは定義側が決める）。 */
  constructor(number: number, def: PropertyDef, owner: WorldObject) {
    this._number = number;
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
    if (session !== undefined) this.def.checkRangeEvents(this._number, this.owner, session);
  }

  /** 絶対値代入（set）。差分をaddへ委譲するため、range判定はadd側に一本化される。 */
  setNumber(value: number, session: WorldSession | undefined): void {
    this.add(value - this._number, session);
  }

  /**
   * 効果を登録する。modify用/accumulate用のどちらのリストへ入るかは効果自身が決めてregisterModify/
   * registerAccumulateを呼び分ける。
   */
  registerPassiveEffect(effect: RegisteredPassiveEffect): void {
    effect.registerInto(this);
  }

  /** modify効果としての登録先（RegisteredPassiveEffect.registerInto経由でのみ呼ばれる想定）。 */
  registerModify(effect: RegisteredPassiveEffect): void {
    this.modifyEffects.push(effect);
  }

  /** accumulate効果としての登録先（RegisteredPassiveEffect.registerInto経由でのみ呼ばれる想定）。 */
  registerAccumulate(effect: RegisteredPassiveEffect): void {
    this.accumulateEffects.push(effect);
  }

  unregisterPassiveEffectsFrom(declarer: WorldObject): void {
    removeWhere(this.modifyEffects, (c) => c.declarer === declarer);
    removeWhere(this.accumulateEffects, (c) => c.declarer === declarer);
  }

  /** 現在登録されている全寄与（modify/accumulate両方）。UI表示用。 */
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
   * accumulateを実体値へ加減算し（8.4節、不可逆）、rangeイベント（6.3節）を判定する。
   * 1tickにつき1回、WorldObject.tick経由で呼ばれる想定。
   */
  tick(session: WorldSession): void {
    for (const c of this.accumulateEffects) this._number += c.activeAmount();

    this.def.checkRangeEvents(this._number, this.owner, session);
  }

  /**
   * 今まさに指定した名前のstage（6.4節）に該当しているか（WhenOwnStageゲート専用、8節）。生の値ではなく
   * 実効値で判定する（modifyだけで決まる派生プロパティ自身のstagesも判定できるようにするため）。
   */
  isInStage(stageName: string): boolean {
    return this.def.isInStage(this.getEffectiveValue(), stageName);
  }

  /**
   * 今の値を読み取る。実効値で読むのは、画面に出すのが「今そう見えている値」（modify・inheritを
   * 加味した値）であるため。
   */
  read(): PropertyReading {
    const value = this.getEffectiveValue();
    return {
      name: this.def.name,
      value,
      ratio: this.def.ratioOf(value),
      alert: this.def.alertLevelOf(value),
      worsensUpward: this.def.worsensUpward,
    };
  }

  /** タグ（6.7節）が付いていれば今の値を読み取る。付いていなければundefined。 */
  readIfTagged(tagGlobalId: number): PropertyReading | undefined {
    return this.def.hasTag(tagGlobalId) ? this.read() : undefined;
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
