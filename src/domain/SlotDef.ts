import type { WorldObject } from './WorldObject';
import type { ObjectDef } from './ObjectDef';
import type { DeclaredNumberReading } from './EffectReader';
import type { DeclaredNumber } from './DeclaredNumber';
import { ReferenceContext } from './ReferenceRoot';
import type { TypeMatchRule } from './TypeMatchRule';

/**
 * 誰がその枠へ物を入れる走査に参加するか（`placement`、GameElementDefinition.md 7.7節）。
 * `auto`はspawn/moveの宣言順走査（9.4節）、`manual`はプレイヤーが札を重ねたときの走査（7.8節）。
 */
export type Placement = 'auto' | 'manual';

/**
 * 1つのセル（枠）の定義（GameElementDefinition.md 7.2節）。スロットは中身を直接持たず、セルの並びを
 * 持つ——「板の枠が1つ、棒の枠が1つ（4本まで）」のように、枠ごとに違う要件を書けるようにするため。
 *
 * **個数は持たない。** そのセルに何個入るかはCellDef.max、枠がいくつあるかはSlotDef.cellCount、
 * かさの合計はSlotDef.capacityが答える（SlotSystem.md 2節）。
 */
export class CellDef {
  /** 受け入れる型（`accept`）。undefinedならどんな型でも受け入れる。 */
  readonly accept: TypeMatchRule | undefined;

  /**
   * このセルに積める同種の個数（undefined=無制限）。**スタックできる型にだけ効く**——
   * `stackable: false` な型（道・かご）は同種でも束ならないので、1セルには必ず1個しか入らない。
   */
  readonly max: number | undefined;

  constructor(accept: TypeMatchRule | undefined, max: number | undefined) {
    this.accept = accept;
    this.max = max;
  }

  /** このセルがcandidateを受け入れる型か（個数は見ない）。 */
  accepts(candidateDef: ObjectDef): boolean {
    return this.accept === undefined || this.accept.matches(candidateDef);
  }
}

/** 枠ごとの受け入れ宣言の読み上げ（SlotDef.cellsReading参照）。 */
export type CellsReading =
  | { readonly kind: 'uniform'; readonly cell: CellDef }
  | { readonly kind: 'perCell'; readonly cells: readonly CellDef[] };

/** どんな型でも無制限に積めるセル（`cell`も`cells`も書かれていないスロットの既定）。 */
const ANY_CELL = new CellDef(undefined, undefined);

/**
 * 1つの ObjectDef が持つ、1つのスロットの定義（GameElementDefinition.md 7.1〜7.3節）。
 * ObjectDef.slotDefs の1要素として、ローカルIDをそのままindexとする密配列に格納される。
 */
export class SlotDef {
  readonly globalId: number;
  readonly name: string;

  /**
   * 枠の数（undefined=決まっていない）。**数を決めることと位置が安定することは同じ**——枠が5つだと
   * 分かっていれば「5番目が空いている」と言えるが、長さが可変の並びには指し示すべき空き枠が無いので
   * 詰めるしかない（SlotSystem.md 3節）。
   */
  readonly cellCount: number | undefined;

  /** 枠ごとの定義。cellCountを持つスロットではその長さ、持たないスロットは空（sharedCellを使う）。 */
  private readonly cellDefs: readonly CellDef[];

  /** 枠数が決まっていないスロットの、すべての枠に共通する定義。 */
  private readonly sharedCell: CellDef;

  /** 合計サイズの上限（GameElementDefinition.md 7.3節）。undefined なら無制限。 */
  readonly capacity: number | undefined;

  /**
   * **誰がここへ物を入れてよいか**（`placement`、GameElementDefinition.md 7.7節。既定は両方）。
   *
   * autoはspawn/moveの宣言順走査（同節）の対象になるか、manualはプレイヤーが札を重ねて入れられるか。
   * どちらもfalseなら、スロット名を名指しした移動でしか入らない（隠された道の枠）。
   */
  readonly autoPlacement: boolean;
  readonly manualPlacement: boolean;

  /**
   * ここへ物を入れるのにかかるゲーム内時間（GameElementDefinition.md 7.10節）。undefinedなら一瞬。
   *
   * **時間を課すのは入れる側だけ**で、出すのは常に一瞬。当てるのに手間がかかっても外すのは一瞬、
   * という非対称の方が普通のため。値の解決はcombinationのdurationと同じ形で、`self`が枠の持ち主、
   * `dragged`が入れる物（putInMinutes参照）。
   */
  private readonly putInDuration: DeclaredNumber | undefined;

  constructor(
    globalId: number,
    name: string,
    cells: readonly CellDef[] | undefined,
    sharedCell: CellDef | undefined,
    cellCount: number | undefined,
    capacity: number | undefined,
    autoPlacement = true,
    putInDuration: DeclaredNumber | undefined = undefined,
    manualPlacement = true,
  ) {
    this.globalId = globalId;
    this.name = name;
    this.sharedCell = sharedCell ?? ANY_CELL;
    this.cellCount = cells !== undefined ? cells.length : cellCount;
    this.cellDefs =
      cells ?? (cellCount === undefined ? [] : Array.from({ length: cellCount }, () => this.sharedCell));
    this.capacity = capacity;
    this.autoPlacement = autoPlacement;
    this.manualPlacement = manualPlacement;
    this.putInDuration = putInDuration;
  }

  /** placementの走査（7.7節）に参加する枠か。 */
  allows(placement: Placement): boolean {
    return placement === 'auto' ? this.autoPlacement : this.manualPlacement;
  }

  /**
   * ここへ入れるのに時間がかかるか（`put_in`の宣言があるか）。値そのものはownerとitemで変わるので、
   * 「宣言しているか」だけを答える。
   */
  get hasPutInDuration(): boolean {
    return this.putInDuration !== undefined;
  }

  /**
   * 空けておく枠（SlotSystem.md 3節）。枠数を宣言したスロットはその数、**宣言していないスロットは
   * `'grows'`**——物を入れるたびに枠が1つ増え、空になった枠は残さず詰める。
   *
   * **「枠数が固定か」と「前詰めか」は同じ1つの問い**なので、別々には答えない（同節）。読む側が
   * `cellCount`の有無から組み立てると、その judgment が読む側の数だけ増える。
   */
  get cellsToKeep(): number | 'grows' {
    return this.cellCount ?? 'grows';
  }

  /**
   * どんな型でも1つしか受け取れない枠か（枠が1つで、そこに同種を束ねない）。**まとめて落とせるか**を
   * 型を持たずに言える唯一の形で、時間のかかる枠がこれを外れていないかの見張りに使う。
   */
  get acceptsAtMostOne(): boolean {
    return this.cellCount === 1 && this.cellDefs.every((cell) => cell.max === 1);
  }

  /** itemをownerのこのスロットへ入れるのにかかる分数（宣言が無ければ0）。 */
  putInMinutes(owner: WorldObject, actor: WorldObject | undefined, item: WorldObject): number {
    return this.putInDuration === undefined
      ? 0
      : Math.trunc(this.putInDuration.resolve(ReferenceContext.acting(owner, actor, item)));
  }

  /**
   * 枠ごとの受け入れ宣言（7.2節）。**枠の内訳が位置ごとに違うときだけ位置ごとに並ぶ**——全部同じなら
   * 1つで足りるので、読み手は位置を添えるかどうかをこの形で見分ける。
   */
  get cellsReading(): CellsReading {
    return this.cellDefs.every((cell) => cell === this.sharedCell)
      ? { kind: 'uniform', cell: this.sharedCell }
      : { kind: 'perCell', cells: this.cellDefs };
  }

  /** ここへ物を入れるのにかかる時間（7.10節）の宣言。省いていればundefined（一瞬で入る）。 */
  get putInDurationReading(): DeclaredNumberReading | undefined {
    return this.putInDuration?.reading;
  }

  /** index番目の枠の定義。枠数が決まっていないスロットではどの位置でも共通の定義。 */
  cellAt(index: number): CellDef {
    return this.cellDefs[index] ?? this.sharedCell;
  }

  /** どれかの枠が受け入れる型か。「そもそもこのスロットに入りうるか」を型だけで問う。 */
  acceptsAnywhere(candidateDef: ObjectDef): boolean {
    return this.cellCount === undefined
      ? this.sharedCell.accepts(candidateDef)
      : this.cellDefs.some((cell) => cell.accepts(candidateDef));
  }
}
