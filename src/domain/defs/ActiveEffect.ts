import type { PropertyValue } from '../runtime/PropertyValue';
import type { EffectSite, WorldObject } from '../runtime/WorldObject';
import type { WorldSession } from '../runtime/WorldSession';
import type { ReferenceRoot } from './ReferenceRoot';

/**
 * 「条件成立時に何を起こすか」を表すポリモーフィックな効果1つ（9・10節）。対象の解決と適用まで自分で行う。
 * 具象は、単一の命令（Set/Add/Destroy/Spawn/Transfer、9節）、その宣言順合成（ActiveEffects）、
 * weightで1候補を選ぶpick（PickEffect、10節。候補もActiveEffectなので再帰しうる）の3種。
 * activeとpickの排他は「ActiveEffect型の変数が1つ」というだけで表せる（判別子不要）。
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
}

/**
 * 一時的な命令（`set`/`add`/`destroy`/`spawn`/`transfer`、9節）を宣言順にまとめた合成効果。
 * on_min・on_overflow・on_shortfall（6節）、actions/combinations/pickのactive（11・12・10節）が共用する。
 * on_min/on_overflow/on_shortfallはselfのみが有効な対象（パーサ側で強制する）。
 */
export class ActiveEffects extends ActiveEffect {
  /**
   * 単一命令の宣言順リスト。適用順はリスト順（パーサがset→add→transfer→destroy→spawnの順で並べる。
   * 同一プロパティへのset後add、destroyで空いた位置へのspawn（same_slot）という依存関係のため）。
   */
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
   * transfer（9.5節）のlinked_add用: amount*numerator/denominator（整数除算）にスケールした量を
   * 加減算する。スケール後が0なら何もしない。
   */
  applyScaled(
    owner: WorldObject,
    session: WorldSession,
    actor: WorldObject | undefined,
    dragged: WorldObject | undefined,
    numerator: number,
    denominator: number,
  ): void {
    const scaled = Math.trunc((this.amount * numerator) / denominator);
    if (scaled === 0) return;
    const resolved = owner.resolveEffectTargetOrAncestor(this.target, this.propertyGlobalId, actor, dragged);
    resolved?.addNumber(this.propertyGlobalId, scaled, session);
  }
}

/**
 * destroy の1命令（対象オブジェクトそのものを削除する、9.3節）。`destroy: [self, dragged]`は
 * 要素2つのDestroyEffectとして表す。same_slot spawnとの連携はeffectSite（ActiveEffect参照）が担う。
 */
export class DestroyEffect extends ActiveEffect {
  private readonly target: ReferenceRoot;

  constructor(target: ReferenceRoot) {
    super();
    this.target = target;
  }

  apply(
    owner: WorldObject,
    session: WorldSession,
    actor: WorldObject | undefined,
    dragged: WorldObject | undefined,
  ): void {
    const victim = owner.resolveEffectTarget(this.target, actor, dragged);
    victim?.destroy(session.codex.wellKnown);
  }
}

/**
 * spawn の配置先（9.4節）が起点にする参照ルート。スロットは指定せず、起点が持つスロットを宣言順に
 * 走査して最初に配置できた所へ入れる（著者がスロット名を知らなくてよい）。fallbackはYAML上に存在せず、
 * 配置失敗時は必ず起点自身の親へ伝播する（WorldObject.place参照）。on_min/on_overflow/on_shortfallには
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
  | 'actor';

/**
 * spawn（9.4節）の1命令。Into への配置に失敗した場合は必ず起点の親へ伝播し、accepts/capacityを無視して
 * 強制配置する（オブジェクトは必ずどこかの親に属す必要があるため。YAML側に選択の余地はない）。
 * 伝播先の親も無い場合、spawnしたオブジェクトは配置されないまま消える。
 */
export class SpawnEffect extends ActiveEffect {
  readonly objectGlobalId: number;
  readonly into: SpawnTargetRoot;

  constructor(objectGlobalId: number, into: SpawnTargetRoot) {
    super();
    this.objectGlobalId = objectGlobalId;
    this.into = into;
  }

  apply(
    owner: WorldObject,
    session: WorldSession,
    actor: WorldObject | undefined,
    dragged: WorldObject | undefined,
    effectSite: EffectSite | undefined,
  ): void {
    owner.executeSpawn(this, session, actor, effectSite);
  }
}

/**
 * transfer（9.5節）の1命令。fromプロパティの実体値から、実際に出せる量とAmountの小さい方だけを
 * toプロパティへ移す（「在庫に応じて実際に動く量が変わる」移送）。YAMLはフラットな
 * `from_object`/`from_prop`/`to_object`/`to_prop`の4フィールドで表す。
 */
export class TransferEffect extends ActiveEffect {
  private readonly fromObject: ReferenceRoot;
  private readonly fromPropertyGlobalId: number;
  private readonly toObject: ReferenceRoot;
  private readonly toPropertyGlobalId: number;
  private readonly amount: number;
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
  ) {
    super();
    this.fromObject = fromObject;
    this.fromPropertyGlobalId = fromPropertyGlobalId;
    this.toObject = toObject;
    this.toPropertyGlobalId = toPropertyGlobalId;
    this.amount = amount;
    this.allowOverflow = allowOverflow;
    this.linkedAdd = linkedAdd;
  }

  /**
   * 移動量は「出せる量」（PropertyValue.availableToTransferOut）とAmountの小さい方。allow_overflowが
   * falseならさらに「受け取れる量」（remainingTransferCapacity）でも制限する。linked_add（9.5節）は
   * 実際に移動した量に比例（amount * actual_moved / Amount、整数除算）してスケール適用する。
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

    let moved = Math.min(this.amount, fromValue.availableToTransferOut());
    if (!this.allowOverflow) moved = Math.min(moved, toValue.remainingTransferCapacity());
    if (moved <= 0) return;

    from.addNumber(this.fromPropertyGlobalId, -moved, session);
    to.addNumber(this.toPropertyGlobalId, moved, session);

    for (const linked of this.linkedAdd)
      linked.applyScaled(owner, session, actor, dragged, moved, this.amount);
  }
}
