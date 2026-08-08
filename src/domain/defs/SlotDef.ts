import type { ObjectDef } from './ObjectDef';

/** 1つのCellAcceptRuleが何を基準にマッチングするか。 */
export type SlotAcceptTargetKind =
  /** withはタグのグローバルID（4節）。candidateDefがそのタグを持っていれば真。 */
  | 'tag'
  /**
   * withはobject_defそのもののグローバルID。candidateDefがまさにその型そのものであれば真
   * （レシピ制作中オブジェクトが特定の素材の型だけを受け入れたい場合など、そのためだけの単発タグを
   * 新設するまでもないケース向け）。
   */
  | 'object';

/**
 * 1つのセルが受け入れる型（GameElementDefinition.md 7.2節の`accept`）。targetKindに応じて、withを
 * タグ（4節）かobject_defのグローバルIDとして解釈する（matches参照）。trait名では直接マッチング
 * しない（traitはmixin合成後に消える。trait経由のタグ付けはtags（4節）を使う）。
 *
 * **個数は持たない。** そのセルに何個入るかはCellDef.max、枠がいくつあるかはSlotDef.cellCount、
 * かさの合計はSlotDef.capacityが答える（SlotSystem.md 2節）。
 */
export class CellAcceptRule {
  readonly targetKind: SlotAcceptTargetKind;
  private readonly with: number;

  constructor(targetKind: SlotAcceptTargetKind, withId: number) {
    this.targetKind = targetKind;
    this.with = withId;
  }

  /** tagならcandidateがそのタグを持てば真、objectならまさにそのobject_defであれば真。 */
  matches(candidateDef: ObjectDef): boolean {
    return this.targetKind === 'tag'
      ? candidateDef.tags.includes(this.with)
      : candidateDef.globalId === this.with;
  }
}

/**
 * 1つのセル（枠）の定義（GameElementDefinition.md 7.2節）。スロットは中身を直接持たず、セルの並びを
 * 持つ——「板の枠が1つ、棒の枠が1つ（4本まで）」のように、枠ごとに違う要件を書けるようにするため。
 */
export class CellDef {
  /** 受け入れる型。undefinedならどんな型でも受け入れる。 */
  readonly accept: CellAcceptRule | undefined;

  /**
   * このセルに積める同種の個数（undefined=無制限）。**スタックできる型にだけ効く**——
   * `stackable: false` な型（道・かご）は同種でも束ならないので、1セルには必ず1個しか入らない。
   */
  readonly max: number | undefined;

  constructor(accept: CellAcceptRule | undefined, max: number | undefined) {
    this.accept = accept;
    this.max = max;
  }

  /** このセルがcandidateを受け入れる型か（個数は見ない）。 */
  accepts(candidateDef: ObjectDef): boolean {
    return this.accept === undefined || this.accept.matches(candidateDef);
  }
}

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
   * spawn/moveの宣言順走査（GameElementDefinition.md 7.7節）の対象になるか（既定true）。falseなら、
   * このスロットへはプレイヤーの手動配置とスロット名を名指しした移動でしか入らない（例: 装備欄）。
   */
  readonly autoPlacement: boolean;

  constructor(
    globalId: number,
    name: string,
    cells: readonly CellDef[] | undefined,
    sharedCell: CellDef | undefined,
    cellCount: number | undefined,
    capacity: number | undefined,
    autoPlacement = true,
  ) {
    this.globalId = globalId;
    this.name = name;
    this.sharedCell = sharedCell ?? ANY_CELL;
    this.cellCount = cells !== undefined ? cells.length : cellCount;
    this.cellDefs =
      cells ?? (cellCount === undefined ? [] : Array.from({ length: cellCount }, () => this.sharedCell));
    this.capacity = capacity;
    this.autoPlacement = autoPlacement;
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
