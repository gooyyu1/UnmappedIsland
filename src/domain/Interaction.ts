import type { InteractionDef } from './InteractionDef';
import type { ActionTrigger, DragTrigger, InteractionTrigger } from './InteractionTrigger';
import type { Requirement } from './Requirement';
import type { WorldObject } from './WorldObject';
import { ReferenceContext } from './ReferenceRoot';

/**
 * 起こす相手が決まった操作1つ（ActionSystem.md 1節）。
 *
 * きっかけ（`InteractionTrigger`）と、それがぶら下げている宣言は `ObjectDef` のもので、**どの個体の
 * 話かを知らない**。だから宣言へ直に頼むと、所要時間を訊くにも実行するにも「誰の」「誰に」を毎回
 * 渡し直すことになる。引いた時点で相手を結び付けておけば、以降は名前も相手も渡さない。
 *
 * **重ねる相手（dragged）を持つかどうかだけが具象の差**なので、持たない側（Action）はundefinedを
 * 1度だけここへ渡す。訊き方も実行の仕方も具象では変わらない。
 */
abstract class Interaction<G extends InteractionTrigger, T extends WorldObject | undefined> {
  /** この操作を起こしたきっかけ。宣言はここからぶら下がる。 */
  protected readonly trigger: G;

  /** 誰がこの操作をしていて、誰に、何を重ねているか。宣言へ問うときはこれを渡す。 */
  protected readonly context: ReferenceContext;

  /** 重ねられた相手。メニュー型の操作には居ない（型引数がundefinedになる）。 */
  protected readonly dragged: T;

  protected constructor(trigger: G, self: WorldObject, actor: WorldObject | undefined, dragged: T) {
    this.trigger = trigger;
    this.context = ReferenceContext.acting(self, actor, dragged);
    this.dragged = dragged;
  }

  protected get def(): InteractionDef {
    return this.trigger.interaction;
  }

  /** この操作を宣言している側の個体（self）。**引いた時点で必ず居る**ので、文脈のselfは空にならない。 */
  protected get self(): WorldObject {
    return this.context.self!;
  }

  get name(): string {
    return this.def.name;
  }

  /** 実行にかかるゲーム内時間（分）。durationを省いていれば0。実行前に見せる用途にも使う。 */
  minutes(): number {
    return this.def.minutesFor(this.context);
  }

  /** 今実行できない理由（最初に落ちた要件、14節）。実行できるならundefined。 */
  unmetRequirement(): Requirement | undefined {
    return this.def.unmetRequirement(this.context);
  }

  tryExecute(): boolean {
    return this.def.execute(this.context, this.self.session);
  }
}

/** 相手を伴わない操作（GameElementDefinition.md 11節）。1枚のカードだけで完結するので、相手は居ない。 */
export class Action extends Interaction<ActionTrigger, undefined> {
  constructor(trigger: ActionTrigger, self: WorldObject, actor: WorldObject | undefined) {
    super(trigger, self, actor, undefined);
  }
}

/**
 * 相手（dragged）まで決まった組み合わせ1つ（GameElementDefinition.md 12節）。
 *
 * **今成立するものしか作られない**（WorldObject.combinationsWith）ので、持っているだけで「重ねれば
 * 何かが起きる」と言える。
 */
export class Combination extends Interaction<DragTrigger, WorldObject> {
  constructor(trigger: DragTrigger, self: WorldObject, dragged: WorldObject, actor: WorldObject | undefined) {
    super(trigger, self, actor, dragged);
  }

  /**
   * 自分の相手に続けてfollowers（同じ束の仲間）を重ねるとき、続けて実行できる個数（自分を含む）。
   * `allow_multiple`（12.4節）を宣言していなければ1までになる。
   *
   * 落とす前に「何枚ついてくるか」を決めるための問い。枠の受け入れ個数を訊く
   * WorldObject.acceptedCountForMoveToと同じ形。
   */
  acceptedCount(followers: readonly WorldObject[]): number {
    return this.trigger.acceptedCount(this.context, [this.dragged, ...followers]);
  }

  /**
   * 自分の相手に続けてfollowersに対しても、同じ宣言を繰り返す（12.4節）。
   *
   * **1つ実行するたびに世界が変わる**ので、都度まだ成立するかを見直し、成立しなくなった時点で止める
   * ——満杯になった炉へ薪をくべ続けて、黙って薪だけ失うことにならないように。
   *
   * 戻り値: 実行できた個数。
   */
  executeWithFollowers(followers: readonly WorldObject[]): number {
    let done = 0;
    for (const dragged of [this.dragged, ...followers]) {
      const now = this.self
        .combinationsWith(dragged, this.context.actor)
        .find((candidate) => candidate.trigger === this.trigger);
      if (now === undefined || !now.tryExecute()) break;
      done++;
    }
    return done;
  }

  /**
   * **相手の型も実行の時点で引き直す。** 候補に選ばれてから落とされるまでに、相手が別の型になっている
   * ことがある（`become`、9.9節）——宣言が要件を引き直すのと同じ理由。
   */
  override tryExecute(): boolean {
    if (!this.trigger.acceptsDragged(this.dragged.def)) return false;
    return super.tryExecute();
  }
}
