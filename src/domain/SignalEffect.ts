import type { WorldObject } from './WorldObject';
import type { WorldSession } from './WorldSession';
import { ActiveEffect } from './ActiveEffect';
import type { EffectReader } from './EffectReader';
import type { ReferenceRoot } from './ReferenceRoot';

/**
 * signal（9.8節）の1命令: 世界の形を何も変えず、**出来事が起きたことだけ**を告げる効果。
 *
 * 観測する側は世界に起きた出入り（`WorldChange`）から「誰が何をしたか」を読む（ActionSystem.md 7節）
 * ため、何も出入りしない出来事は読み取る手掛かりを持たない。空振りは「何も起きなかった」ではなく
 * 「外したことが起きた」なので、それを告げるのがこの命令。
 *
 * 名前は表示のためだけの識別子で、要件のreason（14.6節）と同じくグローバルIDへは畳まない。
 */
export class SignalEffect extends ActiveEffect {
  /** 何が起きたかの識別子。localeのsignal_textsを引く。 */
  readonly name: string;

  /** 誰の身に起きたか。効果を宣言した側とは限らない（武器の側が、殴られた相手について告げる）。 */
  readonly target: ReferenceRoot;

  constructor(name: string, target: ReferenceRoot) {
    super();
    this.name = name;
    this.target = target;
  }

  /** 対象が解決できなければ何も告げない（他の命令が対象を解決できないときと同じ扱い）。 */
  apply(
    owner: WorldObject,
    session: WorldSession,
    actor: WorldObject | undefined,
    dragged: WorldObject | undefined,
  ): void {
    const resolved = owner.resolveEffectTarget(this.target, actor, dragged);
    if (resolved !== undefined) session.recordSignal(this.name, resolved);
  }

  read(reader: EffectReader): void {
    reader.signal(this.name);
  }
}
