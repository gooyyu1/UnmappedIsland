import { ActiveEffect } from './ActiveEffect';
import type { EffectReader } from './EffectReader';
import type { ObjectRef } from './ObjectRef';
import type { WorldObject } from './WorldObject';
import type { WorldSession } from './WorldSession';

/**
 * become の1命令（同じ個体のまま型を差し替える、GameElementDefinition.md 9.9節）。
 *
 * 行き先は識別子ではなく座標で指す（3.5節）。宣言が持つのは**動かす軸とその値**だけで、書かなかった
 * 軸は対象が今居る座標から引き継ぐ——だから、重ねられた容器の種類が実行時にしか決まらない場合でも
 * 行き先を書ける。
 */
export class BecomeEffect extends ActiveEffect {
  private readonly subject: ObjectRef;

  /** 動かす軸 → 行き先の値（`none`はその軸を落とす、GeneratedTypes参照）。 */
  private readonly axisValues: ReadonlyMap<string, string>;

  constructor(subject: ObjectRef, axisValues: ReadonlyMap<string, string>) {
    super();
    this.subject = subject;
    this.axisValues = axisValues;
  }

  apply(
    owner: WorldObject,
    session: WorldSession,
    actor: WorldObject | undefined,
    dragged: WorldObject | undefined,
  ): void {
    this.subject.resolve(owner, actor, dragged)?.becomeAlong(this.axisValues, session);
  }

  /**
   * 対象は解決できるのに行き先の座標に型が居ないなら、この効果を宣言している操作は成立しない
   * （9.9節）。対象そのものが解決できない場合は、他の命令と同じく「その適用を無視する」だけなので
   * 操作は止めない。
   */
  override unresolvable(
    owner: WorldObject,
    actor: WorldObject | undefined,
    dragged: WorldObject | undefined,
  ): boolean {
    const target = this.subject.resolve(owner, actor, dragged);
    return target !== undefined && !target.canBecomeAlong(this.axisValues);
  }

  read(reader: EffectReader): void {
    reader.become(this.subject.reading, this.axisValues);
  }
}
