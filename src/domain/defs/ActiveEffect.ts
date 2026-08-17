import type { InfluenceWriter } from '../runtime/PropertyInfluence';
import type { PropertyValue } from '../runtime/PropertyValue';
import type { EffectSite, WorldObject } from '../runtime/WorldObject';
import type { WorldSession } from '../runtime/WorldSession';
import type { DefNames, DescriptionToken, DescriptionWriter } from './Description';
import { objectRef, propertyRef, signedNumber, text } from './Description';
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

  /** この効果を書き表す（Description参照）。命令1つにつき1行で、入れ子（pick・linked_add）は字下げする。 */
  abstract describe(names: DefNames, out: DescriptionWriter): void;

  /**
   * この効果がpropertyGlobalIdのプロパティを書き換えうるか（プロパティ側からの逆引き用）。
   * ownedByDeclarerの意味はPassiveEffect.affectsと同じ。
   */
  abstract affects(propertyGlobalId: number, ownedByDeclarer: boolean): boolean;

  /**
   * この効果がobjectGlobalIdの型を生み出しうるか（生まれる側からの逆引き用）。
   *
   * 生むのはspawn（9.4節）だけなので、既定は偽。中に他の効果を抱える合成（ActiveEffects・pick）は、
   * 自分の中を見て答える。
   */
  spawns(_objectGlobalId: number): boolean {
    return false;
  }

  /**
   * この効果が何を宣言しているかを読み上げる（EffectReader参照）。**抽象なのは取りこぼしを防ぐため**
   * ——既定を持たせると、動詞を1つ足したときに読み手が黙って何も受け取らなくなる。
   */
  abstract read(reader: EffectReader): void;
}

/**
 * 一時的な命令（`set`/`add`/`destroy`/`spawn`/`transfer`、9節）と`pick`（10節）を、書かれた順に
 * まとめた合成効果。on_overflow・on_shortfall（6節）、actions/combinations/pickの中身（11・12・10節）が
 * 共用する。on_overflow/on_shortfallはselfのみが有効な対象（パーサ側で強制する）。
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

  describe(names: DefNames, out: DescriptionWriter): void {
    for (const operation of this.operations) operation.describe(names, out);
  }

  affects(propertyGlobalId: number, ownedByDeclarer: boolean): boolean {
    return this.operations.some((operation) => operation.affects(propertyGlobalId, ownedByDeclarer));
  }

  override spawns(objectGlobalId: number): boolean {
    return this.operations.some((operation) => operation.spawns(objectGlobalId));
  }

  read(reader: EffectReader): void {
    for (const operation of this.operations) operation.read(reader);
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
    resolved?.setNumber(this.propertyGlobalId, this.value, session);
  }

  describe(names: DefNames, out: DescriptionWriter): void {
    out.write(
      text('set '),
      propertyRef(names.propertyName(this.propertyGlobalId), this.target),
      text(' = '),
      names.propertyValue(this.propertyGlobalId, this.value),
    );
  }

  read(reader: EffectReader): void {
    reader.set(this.target, this.propertyGlobalId, this.value);
  }

  affects(propertyGlobalId: number, ownedByDeclarer: boolean): boolean {
    return this.propertyGlobalId === propertyGlobalId && (ownedByDeclarer || this.target !== 'self');
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
    resolved?.addNumber(this.propertyGlobalId, scaled, session);
  }

  describe(names: DefNames, out: DescriptionWriter): void {
    out.write(...this.describeTokens(names));
  }

  read(reader: EffectReader): void {
    reader.add(this.target, this.propertyGlobalId, this.amount);
  }

  /** transferのlinked_addが、自分を1件として名乗るための読み上げ（LinkedAddReading参照）。 */
  get linkedReading(): LinkedAddReading {
    return { target: this.target, propertyGlobalId: this.propertyGlobalId, amount: this.amount };
  }

  /** transferのlinked_add（比例して効く）が、自分の行へ書き足せるように断片で返す。 */
  describeTokens(names: DefNames): readonly DescriptionToken[] {
    return [
      text('add '),
      propertyRef(names.propertyName(this.propertyGlobalId), this.target),
      text(` ${signedNumber(this.amount)}`),
    ];
  }

  affects(propertyGlobalId: number, ownedByDeclarer: boolean): boolean {
    return this.propertyGlobalId === propertyGlobalId && (ownedByDeclarer || this.target !== 'self');
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

  describe(names: DefNames, out: DescriptionWriter): void {
    out.write(text('destroy '), ...this.target.describe(names));
  }

  /** オブジェクトごと消すだけで、個々のプロパティを書き換えはしない。 */
  affects(): boolean {
    return false;
  }

  read(reader: EffectReader): void {
    reader.destroy(this.target);
  }
}

/**
 * spawn の配置先（9.4節）が起点にする参照ルート。スロットは指定せず、起点が持つスロットを宣言順に
 * 走査して最初に配置できた所へ入れる（著者がスロット名を知らなくてよい）。fallbackはYAML上に存在せず、
 * 配置失敗時は必ず起点自身の親へ伝播する（WorldObject.place参照）。on_overflow/on_shortfallには
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
   * 罠が自分の生んだ獲物へ怪我を渡す経路で、actorを持たないon_shortfallからは他に手段が無い。
   */
  | 'child';

/**
 * spawn（9.4節）の1命令。Into への配置に失敗した場合は必ず起点の親へ伝播し、枠の要件・capacityを無視して
 * 強制配置する（オブジェクトは必ずどこかの親に属す必要があるため。YAML側に選択の余地はない）。
 * 伝播先の親も無い場合、spawnしたオブジェクトは配置されないまま消える。
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
    for (let i = 0; i < this.count; i++) owner.executeSpawn(this, session, actor, effectSite);
  }

  describe(names: DefNames, out: DescriptionWriter): void {
    out.write(
      text('spawn '),
      objectRef(names.objectName(this.objectGlobalId)),
      text(`${this.count === 1 ? '' : ` ×${this.count}`} → ${this.into}`),
    );
  }

  /** 新しいオブジェクトを生むだけで、既にあるプロパティを書き換えはしない。 */
  affects(): boolean {
    return false;
  }

  override spawns(objectGlobalId: number): boolean {
    return this.objectGlobalId === objectGlobalId;
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

    from.addNumber(this.fromPropertyGlobalId, -taken, session);
    to.addNumber(this.toPropertyGlobalId, (taken * this.toAmount) / this.amount, session);

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

  /** suffixは1行目の末尾へ足す断片（tick毎の輸送が、自分のゲートを同じ行に書き足す）。 */
  describe(names: DefNames, out: DescriptionWriter, suffix: readonly DescriptionToken[] = []): void {
    const tokens: DescriptionToken[] = [
      text('transfer '),
      propertyRef(names.propertyName(this.fromPropertyGlobalId), this.fromObject),
      text(' → '),
      propertyRef(names.propertyName(this.toPropertyGlobalId), this.toObject),
      text(`（最大${this.amount}`),
    ];
    // 単位が違う移送（水のmL → 水分のtick数）だけ、受け取る側の量も書く。
    if (this.toAmount !== this.amount) tokens.push(text(` → ${this.toAmount}`));
    if (this.allowOverflow) tokens.push(text('、あふれても移す'));
    tokens.push(text('）'));
    out.write(...tokens, ...suffix);

    if (this.linkedAdd.length === 0) return;
    out.indented(() => {
      for (const linked of this.linkedAdd)
        out.write(...linked.describeTokens(names), text('（実際に移した量に比例）'));
    });
  }

  affects(propertyGlobalId: number, ownedByDeclarer: boolean): boolean {
    if (this.fromPropertyGlobalId === propertyGlobalId && (ownedByDeclarer || this.fromObject !== 'self'))
      return true;
    if (this.toPropertyGlobalId === propertyGlobalId && (ownedByDeclarer || this.toObject !== 'self'))
      return true;
    return this.linkedAdd.some((linked) => linked.affects(propertyGlobalId, ownedByDeclarer));
  }
}
