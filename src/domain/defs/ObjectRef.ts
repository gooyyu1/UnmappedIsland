import type { WorldObject } from '../runtime/WorldObject';
import type { DefNames, DescriptionToken } from './Description';
import { propertyRef, text } from './Description';
import type { ReferenceRoot } from './ReferenceRoot';

/**
 * オブジェクトそのものを1つ指す参照（`destroy`の対象・`move`の`subject`と移動先、9.3節・9.6節）。
 * 指し方は2通りで、どちらも「1つのオブジェクトへ解決する」という同じ役目を持つ。
 *
 * - **対象キー**（`self`/`parent`/`actor`/`dragged`）: 定義時点で決まっている相手。
 * - **プロパティ**（`{prop: ...}`）: その実効値をインスタンスIDとして解釈した相手。定義時点では
 *   決まらず実行時に確定する個体（道が指す土地、動物がぶつかる物）を指す（`ExplorationSystem.md` 3節）。
 *
 * 解決できない場合（プロパティを持たない・そのIDの個体が世界のどこにも居ない）はundefinedで、
 * 呼び出し側は「解決できない適用は無視」の既存規約（9.1節）に従う。
 */
export class ObjectRef {
  /** 対象キーで指す参照ならその起点、プロパティで指す参照ならundefined。 */
  private readonly root: ReferenceRoot | undefined;

  /** プロパティで指す参照ならそのグローバルID、対象キーで指す参照ならundefined。 */
  private readonly propertyGlobalId: number | undefined;

  private constructor(root: ReferenceRoot | undefined, propertyGlobalId: number | undefined) {
    this.root = root;
    this.propertyGlobalId = propertyGlobalId;
  }

  static ofRoot(root: ReferenceRoot): ObjectRef {
    return new ObjectRef(root, undefined);
  }

  static ofProperty(propertyGlobalId: number): ObjectRef {
    return new ObjectRef(undefined, propertyGlobalId);
  }

  /**
   * 今の文脈で指している相手。プロパティで指す参照は、所属ツリーの根から実効値と同じinstanceIdを
   * 持つ子孫を探す（`move`の`to_prop`が移動先を引くのと同じ引き方）。
   */
  resolve(
    owner: WorldObject,
    actor: WorldObject | undefined,
    dragged: WorldObject | undefined,
  ): WorldObject | undefined {
    if (this.root !== undefined) return owner.resolveEffectTarget(this.root, actor, dragged);

    const property = owner.tryGetProperty(this.propertyGlobalId!);
    if (property === undefined) return undefined;
    return owner.findRoot().findDescendantByInstanceId(property.getEffectiveValue());
  }

  /** この参照が、名指しの対象キーrootそのものか（クラフトネットワークの「消費される入力」判定用）。 */
  isRoot(root: ReferenceRoot): boolean {
    return this.root === root;
  }

  /** この参照を書き表す（Description参照）。 */
  describe(names: DefNames): readonly DescriptionToken[] {
    if (this.root !== undefined) return [text(this.root)];
    return [propertyRef(names.propertyName(this.propertyGlobalId!), 'self')];
  }
}
