import type { InfluenceWriter } from './PropertyInfluence';
import type { PropertyValue } from './PropertyValue';
import type { EffectSite } from './EffectSite';
import type { WorldObject } from './WorldObject';
import type { WorldSession } from './WorldSession';
import type { ObjectRef } from './ObjectRef';
import type { EffectReader, LinkedAddReading, TransferReading } from './EffectReader';
import type { ReferenceRoot } from './ReferenceRoot';

/**
 * 「条件成立時に何を起こすか」を表すポリモーフィックな効果1つ（9・10節）。対象の解決と適用まで自分で行う。
 * 具象は、単一の命令（Set/Add/Destroy/Spawn/Transfer、9節）、その宣言順合成（ActiveEffects）、
 * weightで1候補を選ぶpick（PickEffect、10節。候補もActiveEffectなので再帰しうる）の3種。
 * pickは9節の命令と対等な1つの効果なので、合成の中に他の命令と並べて置ける。
 *
 * effectSiteは、適用の入口（WorldObject.applyActiveEffect）で捕捉した「selfが今占めている位置」の
 * スナップショット。same_slot spawnだけがこれを使い、self破棄後でも「その位置がまだ同種を保持しているか」を
 * 配置時に見て置き換え位置を決める（他の効果は無視してよく、destroyが何かを書き込む必要もない）。
 */
export abstract class ActiveEffect {
  abstract apply(
    owner: WorldObject,
    session: WorldSession,
    actor: WorldObject | undefined,
    dragged: WorldObject | undefined,
    effectSite: EffectSite | undefined,
  ): void;

  /**
   * この効果が何を宣言しているかを読み上げる（EffectReader参照）。**抽象なのは取りこぼしを防ぐため**
   * ——既定を持たせると、動詞を1つ足したときに読み手が黙って何も受け取らなくなる。
   */
  abstract read(reader: EffectReader): void;

  /**
   * まとめて実行するとき、回数の上限を決める器がいくつあるか（`allow_multiple`、12.4節）。
   * undefinedは「繰り返すと意味が変わるので数えられない」（pick）。
   *
   * **既定は0＝数に影響しない。** 取りこぼしても「まとめられない」に倒れるだけで安全側なので、readと
   * 違い抽象にしない。数を決められるのは、単調に埋まる器へ入れる効果（transfer）だけ。
   */
  countableVessels(): number | undefined {
    return 0;
  }

  /**
   * 今この文脈で、この効果が行き先を持たないために、宣言している操作そのものが成立しないか
   * （`become` の座標が空、9.9節）。成立しない操作は候補に出さない——落とせるのに何も起きない、を
   * 作らないため。
   *
   * **既定はfalse＝妨げない。** countableVesselsと同じく、取りこぼしても安全側（操作は出る）に
   * 倒れるので抽象にしない。
   */
  unresolvable(
    _owner: WorldObject,
    _actor: WorldObject | undefined,
    _dragged: WorldObject | undefined,
  ): boolean {
    return false;
  }

  /**
   * candidatesを先頭から順に、この効果を続けて何回適用できるか。undefinedは「答えられない」。
   * 各candidateはdraggedの役で、器（countableVessels）を持つ効果だけが答える。
   */
  acceptedCount(
    _owner: WorldObject,
    _candidates: readonly WorldObject[],
    _actor: WorldObject | undefined,
  ): number | undefined {
    return undefined;
  }
}

/**
 * 一時的な命令（`set`/`add`/`destroy`/`spawn`/`transfer`、9節）と`pick`（10節）を、書かれた順に
 * まとめた合成効果。on_max・on_min（6節）、actions/combinations/pickの中身（11・12・10節）が
 * 共用する。on_max/on_minはselfのみが有効な対象（パーサ側で強制する）。
 * 空（命令が1つも無い）なら、適用しても何も起きない。
 */
export class ActiveEffects extends ActiveEffect {
  /** 効果の宣言順リスト。適用順はリスト順で、パーサはYAMLに書かれた順のまま渡す（9.7節）。 */
  private readonly operations: readonly ActiveEffect[];

  constructor(operations: readonly ActiveEffect[]) {
    super();
    this.operations = operations;
  }

  apply(
    owner: WorldObject,
    session: WorldSession,
    actor: WorldObject | undefined,
    dragged: WorldObject | undefined,
    effectSite: EffectSite | undefined,
  ): void {
    for (const operation of this.operations) operation.apply(owner, session, actor, dragged, effectSite);
  }

  read(reader: EffectReader): void {
    for (const operation of this.operations) operation.read(reader);
  }

  /** 1つでも成立しない子があれば、合成も成立しない（並べた命令はすべて起こる約束のため）。 */
  override unresolvable(
    owner: WorldObject,
    actor: WorldObject | undefined,
    dragged: WorldObject | undefined,
  ): boolean {
    return this.operations.some((operation) => operation.unresolvable(owner, actor, dragged));
  }

  /** 子の合計。1つでも数えられない子（pick）があれば、合成も数えられない。 */
  override countableVessels(): number | undefined {
    let total = 0;
    for (const operation of this.operations) {
      const vessels = operation.countableVessels();
      if (vessels === undefined) return undefined;
      total += vessels;
    }
    return total;
  }

  /** 器を持つ子（ちょうど1つであることはロード時に確かめてある）に訊く。 */
  override acceptedCount(
    owner: WorldObject,
    candidates: readonly WorldObject[],
    actor: WorldObject | undefined,
  ): number | undefined {
    for (const operation of this.operations) {
      const count = operation.acceptedCount(owner, candidates, actor);
      if (count !== undefined) return count;
    }
    return undefined;
  }
}

/** set の1命令（対象プロパティへリテラルの絶対値を代入する、9.2節）。 */
export class SetEffect extends ActiveEffect {
  private readonly target: ReferenceRoot;
  private readonly propertyGlobalId: number;
  private readonly value: number;

  constructor(target: ReferenceRoot, propertyGlobalId: number, value: number) {
    super();
    this.target = target;
    this.propertyGlobalId = propertyGlobalId;
    this.value = value;
  }

  apply(
    owner: WorldObject,
    session: WorldSession,
    actor: WorldObject | undefined,
    dragged: WorldObject | undefined,
  ): void {
    const resolved = owner.resolveEffectTargetOrAncestor(this.target, this.propertyGlobalId, actor, dragged);
    resolved?.tryGetProperty(this.propertyGlobalId)?.setNumber(this.value);
  }

  read(reader: EffectReader): void {
    reader.set(this.target, this.propertyGlobalId, this.value);
  }
}

/** add の1命令（対象プロパティへ加減算する）。 */
export class AddEffect extends ActiveEffect {
  private readonly target: ReferenceRoot;
  private readonly propertyGlobalId: number;
  private readonly amount: number;

  constructor(target: ReferenceRoot, propertyGlobalId: number, amount: number) {
    super();
    this.target = target;
    this.propertyGlobalId = propertyGlobalId;
    this.amount = amount;
  }

  apply(
    owner: WorldObject,
    session: WorldSession,
    actor: WorldObject | undefined,
    dragged: WorldObject | undefined,
  ): void {
    this.applyScaled(owner, session, actor, dragged, 1, 1);
  }

  /**
   * transfer（9.5節）のlinked_add用: amount*numerator/denominatorにスケールした量を加減算する。
   * スケール後が0なら何もしない。
   */
  applyScaled(
    owner: WorldObject,
    session: WorldSession,
    actor: WorldObject | undefined,
    dragged: WorldObject | undefined,
    numerator: number,
    denominator: number,
  ): void {
    const scaled = (this.amount * numerator) / denominator;
    if (scaled === 0) return;
    const resolved = owner.resolveEffectTargetOrAncestor(this.target, this.propertyGlobalId, actor, dragged);
    resolved?.tryGetProperty(this.propertyGlobalId)?.add(scaled);
  }

  read(reader: EffectReader): void {
    reader.add(this.target, this.propertyGlobalId, this.amount);
  }

  /** transferのlinked_addが、自分を1件として名乗るための読み上げ（LinkedAddReading参照）。 */
  get linkedReading(): LinkedAddReading {
    return { target: this.target, propertyGlobalId: this.propertyGlobalId, amount: this.amount };
  }
}

/**
 * destroy の1命令（対象オブジェクトそのものを削除する、9.3節）。`destroy: [self, dragged]`は
 * 要素2つのDestroyEffectとして表す。same_slot spawnとの連携はeffectSite（ActiveEffect参照）が担う。
 */
export class DestroyEffect extends ActiveEffect {
  private readonly target: ObjectRef;

  constructor(target: ObjectRef) {
    super();
    this.target = target;
  }

  apply(
    owner: WorldObject,
    session: WorldSession,
    actor: WorldObject | undefined,
    dragged: WorldObject | undefined,
  ): void {
    const victim = this.target.resolve(owner, actor, dragged);
    victim?.destroy();
  }

  read(reader: EffectReader): void {
    reader.destroy(this.target.reading);
  }
}

/**
 * spawn の配置先（9.4節）が起点にする参照ルート。スロットは指定せず、起点が持つスロットを宣言順に
 * 走査して最初に配置できた所へ入れる（著者がスロット名を知らなくてよい）。fallbackはYAML上に存在せず、
 * 配置失敗時は必ず起点自身の親へ伝播する（WorldObject.place参照）。on_max/on_minには
 * actorが存在しないため、それらのspawnでintoにActorを指定しても何も起きない。
 */
export type SpawnTargetRoot =
  /**
   * into 省略時の既定値。selfが今占めている場所（親と同じスロット）へ配置する。クラフト・腐敗など
   * 「同じ場所で別の物に置き換わる」場合に使う。一意の1スロットのため走査は行わない。
   */
  | 'same_slot'
  /** self が持つスロットを宣言順に走査する。 */
  | 'self'
  /** actor が持つスロットを宣言順に走査する。 */
  | 'actor'
  /**
   * selfの子を順に走査し、最初に受け取れた子のスロットへ入れる。intoが既に持つ「宣言順に走査して最初に
   * 配置できた所へ」という決め方が、1階層下へ伸びるだけ（docs/engine/TrapSystem.md 5.3節）。
   * 罠が自分の生んだ獲物へ怪我を渡す経路で、actorを持たないon_minからは他に手段が無い。
   */
  | 'child';

/**
 * spawn（9.4節）の1命令。intoへの配置に失敗した場合は起点の親へこぼれ、そこも受け取らなければさらに
 * 上へ遡る（WorldObject.spillTo）。**どの段でも枠の宣言はそのまま効く**ので、どこにも入らなければ
 * spawnしたオブジェクトは配置されないまま消える。
 */
export class SpawnEffect extends ActiveEffect {
  readonly objectGlobalId: number;
  readonly into: SpawnTargetRoot;

  /**
   * 生む個数（9.4節、既定1）。同じ宣言を並べるのと同じ意味で、1個ずつ順に生んで配置する
   * ——「2個見つかる」を書くのに同じ行を2度書かせない。
   */
  readonly count: number;

  constructor(objectGlobalId: number, into: SpawnTargetRoot, count = 1) {
    super();
    this.objectGlobalId = objectGlobalId;
    this.into = into;
    this.count = count;
  }

  apply(
    owner: WorldObject,
    session: WorldSession,
    actor: WorldObject | undefined,
    dragged: WorldObject | undefined,
    effectSite: EffectSite | undefined,
  ): void {
    for (let i = 0; i < this.count; i++) owner.executeSpawn(this, actor, effectSite);
  }

  read(reader: EffectReader): void {
    reader.spawn(this.objectGlobalId, this.count);
  }
}

/**
 * transfer（9.5節）の1命令。fromプロパティの実体値から、実際に出せる量とAmountの小さい方だけを
 * toプロパティへ移す（「在庫に応じて実際に動く量が変わる」移送）。YAMLはフラットな
 * `from`/`from_prop`/`to`/`to_prop`の4フィールドで表す。
 *
 * fromとtoの単位が違う場合（mLの水 → tick数のhydration）は、`amount`に対して受け取る側が
 * どれだけ増えるかを`to_amount`が持つ。**換算率をエンジンは知らず、移送する側が宣言する**。
 */
export class TransferEffect extends ActiveEffect {
  private readonly fromObject: ReferenceRoot;
  private readonly fromPropertyGlobalId: number;
  private readonly toObject: ReferenceRoot;
  private readonly toPropertyGlobalId: number;
  private readonly amount: number;
  private readonly toAmount: number;
  private readonly allowOverflow: boolean;
  private readonly linkedAdd: readonly AddEffect[];

  constructor(
    fromObject: ReferenceRoot,
    fromPropertyGlobalId: number,
    toObject: ReferenceRoot,
    toPropertyGlobalId: number,
    amount: number,
    allowOverflow: boolean,
    linkedAdd: readonly AddEffect[] = [],
    toAmount: number = amount,
  ) {
    super();
    this.fromObject = fromObject;
    this.fromPropertyGlobalId = fromPropertyGlobalId;
    this.toObject = toObject;
    this.toPropertyGlobalId = toPropertyGlobalId;
    this.amount = amount;
    this.toAmount = toAmount;
    this.allowOverflow = allowOverflow;
    this.linkedAdd = linkedAdd;
  }

  /**
   * 出す量は「出せる量」（PropertyValue.availableToTransferOut）とAmountの小さい方。allow_overflowが
   * falseならさらに「受け取れる量」（remainingTransferCapacity）でも制限するが、単位が違えば
   * 受け取れる量は移送先の単位なので、**出す側の単位へ割り戻してから**比べる。
   *
   * linked_add（9.5節）は実際に出した量に比例（amount * actual_moved / Amount）してスケール適用する。
   * from/toが解決できない・対象がそのプロパティを持たない場合は何もしない。
   */
  apply(
    owner: WorldObject,
    session: WorldSession,
    actor: WorldObject | undefined,
    dragged: WorldObject | undefined,
  ): void {
    const from = owner.resolveEffectTargetOrAncestor(
      this.fromObject,
      this.fromPropertyGlobalId,
      actor,
      dragged,
    );
    const to = owner.resolveEffectTargetOrAncestor(this.toObject, this.toPropertyGlobalId, actor, dragged);
    if (from === undefined || to === undefined) return;
    const fromValue: PropertyValue | undefined = from.tryGetProperty(this.fromPropertyGlobalId);
    const toValue: PropertyValue | undefined = to.tryGetProperty(this.toPropertyGlobalId);
    if (fromValue === undefined || toValue === undefined) return;

    let taken = Math.min(this.amount, fromValue.availableToTransferOut());
    if (!this.allowOverflow) {
      const room = (toValue.remainingTransferCapacity() * this.amount) / this.toAmount;
      taken = Math.min(taken, room);
    }
    if (taken <= 0) return;

    from.tryGetProperty(this.fromPropertyGlobalId)?.add(-taken);
    to.tryGetProperty(this.toPropertyGlobalId)?.add((taken * this.toAmount) / this.amount);

    for (const linked of this.linkedAdd)
      linked.applyScaled(owner, session, actor, dragged, taken, this.amount);
  }

  /**
   * この輸送の宣言（TransferReading参照）。出す側は`amount`だけ減り、受け取る側は`to_amount`だけ
   * 増え、linked_addは全量移った場合の値で並ぶ。
   *
   * **在庫が満ちている前提の上限。** 実際に動く量は出せる量と空きで目減りする（applyがそれを見る）。
   */
  get reading(): TransferReading {
    return {
      from: this.fromObject,
      fromPropertyGlobalId: this.fromPropertyGlobalId,
      to: this.toObject,
      toPropertyGlobalId: this.toPropertyGlobalId,
      amount: this.amount,
      toAmount: this.toAmount,
      linked: this.linkedAdd.map((linked) => linked.linkedReading),
    };
  }

  /**
   * 移送先が全candidatesで共通なら、その値が器になる（1つ）。移送先がdraggedなら、器はcandidateごとに
   * 別なので回数の上限を決めない（0）。
   */
  override countableVessels(): number | undefined {
    return this.toObject === 'dragged' ? 0 : 1;
  }

  /**
   * 移送先の残り（PropertyValue.remainingTransferCapacity）が尽きるまでに、何個ぶん移せるか。
   * 移送先・移送元が解決できなければ、そこで打ち切る。
   */
  override acceptedCount(
    owner: WorldObject,
    candidates: readonly WorldObject[],
    actor: WorldObject | undefined,
  ): number | undefined {
    if (this.toObject === 'dragged' || candidates.length === 0) return undefined;

    const to = owner.resolveEffectTargetOrAncestor(
      this.toObject,
      this.toPropertyGlobalId,
      actor,
      candidates[0],
    );
    const toValue = to?.tryGetProperty(this.toPropertyGlobalId);
    if (toValue === undefined) return undefined;

    let room = toValue.remainingTransferCapacity();
    let count = 0;
    for (const candidate of candidates) {
      if (room <= 0) break;
      const from = owner.resolveEffectTargetOrAncestor(
        this.fromObject,
        this.fromPropertyGlobalId,
        actor,
        candidate,
      );
      const fromValue = from?.tryGetProperty(this.fromPropertyGlobalId);
      if (fromValue === undefined) break;

      const taken = Math.min(this.amount, fromValue.availableToTransferOut());
      if (taken <= 0) break;
      room -= (taken * this.toAmount) / this.amount;
      count += 1;
    }
    return count;
  }

  read(reader: EffectReader): void {
    reader.transfer(this.reading);
  }

  /**
   * 輸送の両端を影響の辺として書き出す（PropertyInfluences参照）。
   *
   * **両端は互いの原因になる。** 受け取る側が増えるのは出す側の在庫があるからで、出す側が減るのは
   * 受け取る側へ持っていかれるから——1本の輸送が、どちらの端から見ても相手のせいで動いて見える。
   */
  collectInfluences(declarer: WorldObject, active: boolean, out: InfluenceWriter): void {
    const from = declarer.resolveInfluenceTargets(this.fromObject, this.fromPropertyGlobalId)[0];
    const to = declarer.resolveInfluenceTargets(this.toObject, this.toPropertyGlobalId)[0];
    if (from === undefined || to === undefined) return;

    out.write({
      causeObject: from,
      causePropertyGlobalId: this.fromPropertyGlobalId,
      target: to,
      targetPropertyGlobalId: this.toPropertyGlobalId,
      reversible: false,
      increases: true,
      active,
    });
    out.write({
      causeObject: to,
      causePropertyGlobalId: this.toPropertyGlobalId,
      target: from,
      targetPropertyGlobalId: this.fromPropertyGlobalId,
      reversible: false,
      increases: false,
      active,
    });
  }
}
