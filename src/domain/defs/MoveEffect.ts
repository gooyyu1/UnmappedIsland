import type { WorldObject } from '../runtime/WorldObject';
import type { WorldSession } from '../runtime/WorldSession';
import { ActiveEffect } from './ActiveEffect';
import type { EffectReader } from './EffectReader';
import type { ObjectRef } from './ObjectRef';

/**
 * move の1命令。既に世界に存在するオブジェクト（subject）を、移動先のオブジェクトの中へ移動する。
 *
 * YAML: `move: {subject: actor, to_prop: destination_id}` / `move: {subject_prop: smash_target, to: self}`
 * （transfer と同じフラットフィールド規約）。動かす物も行き先も同じ指し方（ObjectRef）で、
 * 定義時点で決まっている相手（対象キー）と実行時に確定する個体（プロパティ）の二択になる。
 *
 * 解決できない・どのスロットも受け入れない場合は何もしない（「解決できない適用は無視」の既存規約）。
 * 配置は moveIntoFirstAcceptingSlot（spawn の into と同じ宣言順走査、force なし）。
 */
export class MoveEffect extends ActiveEffect {
  private readonly subject: ObjectRef;

  private readonly destination: ObjectRef;

  constructor(subject: ObjectRef, destination: ObjectRef) {
    super();
    this.subject = subject;
    this.destination = destination;
  }

  apply(
    owner: WorldObject,
    session: WorldSession,
    actor: WorldObject | undefined,
    dragged: WorldObject | undefined,
  ): void {
    const mover = this.subject.resolve(owner, actor, dragged);
    if (mover === undefined) return;

    const destination = this.destination.resolve(owner, actor, dragged);
    if (destination === undefined) return;

    mover.moveIntoFirstAcceptingSlot(destination, false, session);
  }

  read(reader: EffectReader): void {
    reader.move(this.subject.reading, this.destination.reading);
  }
}
