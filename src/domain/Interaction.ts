import type { ActionDef, ShowMenuMode } from './ActionDef';
import type { CombinationDef } from './CombinationDef';
import type { Requirement } from './Requirement';
import type { WorldObject } from './WorldObject';

/**
 * 起こす相手が決まった操作1つ（ActionSystem.md 1節）。
 *
 * 宣言（ActionDef・CombinationDef）はObjectDefのもので、**どの個体の話かを知らない**。だから宣言へ
 * 直に頼むと、所要時間を訊くにも実行するにも「誰の」「誰に」を毎回渡し直すことになる。引いた時点で
 * 相手を結び付けておけば、以降は名前も相手も渡さない。
 */
export class Action {
  private readonly def: ActionDef;

  /** この操作を宣言している側の個体（self）。 */
  private readonly self: WorldObject;

  /** 操作する本人。時間の側が起こす操作（showMenu: never）ではundefinedになりうる。 */
  private readonly actor: WorldObject | undefined;

  constructor(def: ActionDef, self: WorldObject, actor: WorldObject | undefined) {
    this.def = def;
    this.self = self;
    this.actor = actor;
  }

  get name(): string {
    return this.def.name;
  }

  /** 画面のボタンに出す操作か（11.1節）。 */
  get showMenu(): ShowMenuMode {
    return this.def.showMenu;
  }

  /** 実行にかかるゲーム内時間（分）。durationを省いていれば0。実行前に見せる用途にも使う。 */
  minutes(): number {
    return this.def.minutesFor(this.self, this.actor, undefined);
  }

  /** 今実行できない理由（最初に落ちた要件、14節）。実行できるならundefined。 */
  unmetRequirement(): Requirement | undefined {
    return this.def.unmetRequirement(this.self, this.actor, undefined);
  }

  tryExecute(): boolean {
    return this.def.tryExecute(this.self, this.actor, this.self.session);
  }
}

/**
 * 相手（dragged）まで決まった組み合わせ1つ（GameElementDefinition.md 12節）。Actionと同じ理由で、
 * 宣言ではなくこちらへ頼む。
 *
 * **今成立するものしか作られない**（WorldObject.combinationsWith）ので、持っているだけで「重ねれば
 * 何かが起きる」と言える。
 */
export class Combination {
  private readonly def: CombinationDef;
  private readonly self: WorldObject;

  /** 重ねられた相手。まとめて実行するときは、この1つが先頭になる。 */
  private readonly dragged: WorldObject;

  private readonly actor: WorldObject | undefined;

  constructor(def: CombinationDef, self: WorldObject, dragged: WorldObject, actor: WorldObject | undefined) {
    this.def = def;
    this.self = self;
    this.dragged = dragged;
    this.actor = actor;
  }

  get name(): string {
    return this.def.name;
  }

  /** 1つぶんの所要時間（分）。まとめて実行すれば個数ぶんかかる。 */
  minutes(): number {
    return this.def.minutesFor(this.self, this.actor, this.dragged);
  }

  /**
   * 自分の相手に続けてfollowers（同じ束の仲間）を重ねるとき、続けて実行できる個数（自分を含む）。
   * `allow_multiple`（12.4節）を宣言していなければ1までになる。
   *
   * 落とす前に「何枚ついてくるか」を決めるための問い。枠の受け入れ個数を訊く
   * WorldObject.acceptedCountForMoveToと同じ形。
   */
  acceptedCount(followers: readonly WorldObject[]): number {
    return this.def.acceptedCount(this.self, [this.dragged, ...followers], this.actor);
  }

  tryExecute(): boolean {
    return this.def.tryExecute(this.self, this.actor, this.dragged, this.self.session);
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
      const now = this.self.combinationsWith(dragged, this.actor).find((c) => c.def === this.def);
      if (now === undefined || !now.tryExecute()) break;
      done++;
    }
    return done;
  }
}
