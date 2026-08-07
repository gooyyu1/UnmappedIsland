import type { ObjectDef } from './ObjectDef';

/** 1つのSlotAcceptRuleが何を基準にマッチングするか。 */
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
 * GameElementDefinition.md 7.2節の accepts の1エントリ（型・個数の制約）。targetKindに応じて、
 * withをタグ（4節）かobject_defのグローバルIDとして解釈する（matches参照）。trait名では直接
 * マッチングしない（traitはmixin合成後に消える。trait経由のタグ付けはtags（4節）を使う）。
 */
export class SlotAcceptRule {
  readonly targetKind: SlotAcceptTargetKind;
  private readonly with: number;
  readonly max: number;
  readonly consume: boolean;

  constructor(targetKind: SlotAcceptTargetKind, withId: number, max: number, consume: boolean) {
    this.targetKind = targetKind;
    this.with = withId;
    this.max = max;
    this.consume = consume;
  }

  /** tagならcandidateがそのタグを持てば真、objectならまさにそのobject_defであれば真。 */
  matches(candidateDef: ObjectDef): boolean {
    return this.targetKind === 'tag'
      ? candidateDef.tags.includes(this.with)
      : candidateDef.globalId === this.with;
  }
}

/**
 * 1つの ObjectDef が持つ、1つのスロットの定義（GameElementDefinition.md 7.1〜7.4節）。
 * ObjectDef.slotDefs の1要素として、ローカルIDをそのままindexとする密配列に格納される。
 */
export class SlotDef {
  readonly globalId: number;
  readonly name: string;

  /** 空なら無制限スロット（accepts省略時の既定、7.1節）。 */
  readonly accepts: readonly SlotAcceptRule[];

  /** 合計サイズの上限（GameElementDefinition.md 7.3節）。undefined なら無制限。 */
  readonly capacity: number | undefined;

  /**
   * 同種オブジェクトを表示上1つの単位（スタック）としてまとめるか（既定true）。falseなら同種でも
   * 個体ごとに別単位として数える（例: かまどの投入口。同じ種類の燃料を2つ入れても2枠消費する）。
   */
  readonly stackable: boolean;

  /**
   * このスロットに同時に存在できる「単位」の上限（undefined=無制限）。単位の意味はstackableに従う
   * （trueなら異なるObjectDefの種類数、falseなら個体数そのもの）。既存のcapacity（サイズ合計）
   * とは独立した、種類数/個数ベースの別軸の制約。
   */
  readonly unitCapacity: number | undefined;

  /**
   * 前詰めしないか（既定false）。trueの場合、Runtime側（Slot）が「型→固定番号」の対応表を持ち、
   * 空いた番号を保持したまま詰めない・プレイヤーが手動で並び替え可能、という挙動になる
   * （例: プレイヤー手持ちの6枠）。
   */
  readonly fixedPositions: boolean;

  /**
   * spawn/moveの宣言順走査（GameElementDefinition.md 7.7節）の対象になるか（既定true）。falseなら、
   * このスロットへはプレイヤーの手動配置とスロット名を名指しした移動でしか入らない（例: 装備欄）。
   */
  readonly autoPlacement: boolean;

  /**
   * カードを押したとき、このスロットの中身を子ウィンドウに並べるか（既定false、
   * docs/ui/ScreenLayout.md 子ウィンドウ節）。
   *
   * **見せない側を既定にする。** 見せるということは、プレイヤーがそこから取り出せるということでもある。
   * 液体の容器（content）のように、中身が単独では存在してはいけないスロットを黙って開いてしまうより、
   * 見せたいスロットだけが名乗る方が安全。
   */
  readonly showsContents: boolean;

  constructor(
    globalId: number,
    name: string,
    accepts: readonly SlotAcceptRule[],
    capacity: number | undefined,
    stackable = true,
    unitCapacity?: number,
    fixedPositions = false,
    autoPlacement = true,
    showsContents = false,
  ) {
    this.globalId = globalId;
    this.name = name;
    this.accepts = accepts;
    this.capacity = capacity;
    this.stackable = stackable;
    this.unitCapacity = unitCapacity;
    this.fixedPositions = fixedPositions;
    this.autoPlacement = autoPlacement;
    this.showsContents = showsContents;
  }
}
