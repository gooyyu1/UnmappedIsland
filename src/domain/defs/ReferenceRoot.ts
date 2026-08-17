import type { WorldObject } from '../runtime/WorldObject';

/**
 * conditions（GameElementDefinition.md 14節）・weight（10.2節）・passivesのゲート（8節）・active効果の
 * 対象/参照が共通で参照する起点。self.prop/parent.propのような1階層の参照のみ対応。
 * worldは起点として未対応（ロード時エラー、14.1節）。Ancestorは見つからなければworldまで遡るため、
 * 世界固有の概念の参照はAncestorで代替できる。
 */
export type ReferenceRoot =
  | 'self'
  | 'parent'
  /**
   * passiveのtarget専用（8.1節）。親が宣言した効果を、そのスロットに入った各子へブロードキャスト登録する
   * ために使う。単一の参照先へ解決されるconditions/active/weight/transferの文脈では意味を持たない
   * （それらの許可rootには含めない）。
   */
  | 'child'
  | 'actor'
  /** combinations内でのみ意味を持つ、ドラッグされてきたカード（12.2節）。 */
  | 'dragged'
  /**
   * selfの直接の親から遡り、参照先のプロパティを定義している最初の祖先（WorldObject.findAncestorWithProperty
   * 参照）。SlotPosition判定（{in_slot: ...}）では意味を持たないため未対応（ロード時エラー）。
   */
  | 'ancestor';

/**
 * {subject, prop}が指す、1階層のプロパティ参照（ReferenceRoot＋プロパティのグローバルID）。
 * weightのpath参照（10.2節）・conditionsのvalueRef（14節）・activeのvalueRefが共有する
 * （いずれも「リテラルか参照か」の二択の『参照』側）。
 */
export class PropertyPath {
  readonly root: ReferenceRoot;
  readonly propertyGlobalId: number;

  constructor(root: ReferenceRoot, propertyGlobalId: number) {
    this.root = root;
    this.propertyGlobalId = propertyGlobalId;
  }
}

/**
 * ReferenceRootを実行時のWorldObjectへ解決する。Ancestorはプロパティごとに解決先が変わりうるため
 * 扱わず、各利用側がfindAncestorWithPropertyを併用する（該当なしはundefined）。
 */
export function resolveReferenceRoot(
  root: ReferenceRoot,
  self: WorldObject | undefined,
  actor: WorldObject | undefined,
  dragged: WorldObject | undefined,
): WorldObject | undefined {
  switch (root) {
    case 'self':
      return self;
    case 'parent':
      return self?.parent;
    case 'actor':
      return actor;
    case 'dragged':
      return dragged;
    default:
      return undefined;
  }
}
