/**
 * 身につけたときに占める場所（`covers` / `layer`、GameElementDefinition.md 7.5節）。
 * **同じ部位の同じ階層は1つしか占められない**という不変条件を持つのはこの型で、衝突するかを
 * 答えるのもこの型自身。枠の側は「衝突する物が既に入っているか」を訊くだけでよい（Slot）。
 *
 * 部位は複数、階層は1つ。片方だけの宣言は意味を成さない（部位の無い階層は誰とも重ならず、
 * 階層の無い部位はどの段で重なるかを言えない）ので、対でしか作れない。
 */
export class WornCoverage {
  /** 覆う部位（タグの名前空間のID）。空にはならない。 */
  readonly partTagIds: readonly number[];

  /**
   * 重ね着の階層（タグの名前空間のID）。部位と同じ名前空間に置くのは、どちらも**場所を言う語**で
   * あって物の値ではないため——プレイヤーに見せる値（天気・季節）はシンボルの名前空間に居り、
   * あちらには表示名が要る。
   */
  readonly layerTagId: number;

  constructor(partTagIds: readonly number[], layerTagId: number) {
    if (partTagIds.length === 0) throw new Error('covers には覆う部位が少なくとも1つ要ります（7.5節）。');

    this.partTagIds = partTagIds;
    this.layerTagId = layerTagId;
  }

  /**
   * otherと同じ場所を奪い合うか。同じ階層で、覆う部位が1つでも重なっていれば衝突する。
   * 場所を持たない相手（undefined）とは衝突しない——受け取る側で分岐させないための受け口。
   */
  conflictsWith(other: WornCoverage | undefined): boolean {
    if (other === undefined || other.layerTagId !== this.layerTagId) return false;

    return this.partTagIds.some((partTagId) => other.partTagIds.includes(partTagId));
  }
}
