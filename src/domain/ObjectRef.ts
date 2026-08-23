import type { WorldObject } from './WorldObject';
import type { PropertyPath, ReferenceContext, ReferenceRoot } from './ReferenceRoot';

/**
 * オブジェクトを1つ指す参照の宣言（ObjectRef参照）。指し方の3通りをそのまま表す。
 *
 * **読み手へは実体ではなくこれを渡す。** 「rootそのものか」を尋ねるメソッドを生やすと、
 * 述語の顔をして中身を1つずつ出すことになり、読み手が増えるたびに問いも増える。
 */
export type ObjectRefReading =
  | { readonly kind: 'root'; readonly root: ReferenceRoot }
  /** 実効値をインスタンスIDとして解釈した相手。どの個体かは実行時にしか決まらない。 */
  | { readonly kind: 'property'; readonly subject: ReferenceRoot; readonly propertyGlobalId: number }
  | { readonly kind: 'object'; readonly objectGlobalId: number };

/**
 * オブジェクトそのものを1つ指す参照（`destroy`の対象・`move`の`subject`と移動先、9.3節・9.6節）。
 * 指し方は3通りで、どれも「1つのオブジェクトへ解決する」という同じ役目を持つ。
 *
 * - **対象キー**（`self`/`parent`/`actor`/`dragged`）: 定義時点で決まっている相手。
 * - **プロパティ**（`{subject, prop}`、subject省略時はself）: その実効値をインスタンスIDとして解釈した
 *   相手。定義時点では決まらず実行時に確定する個体（道が指す土地、`among`が選んだ相手の行き先）を
 *   指す（`ExplorationSystem.md` 3節）。
 * - **型**（`{object: ...}`）: 世界にただ1つ在る型（`singleton`、15節）のそのインスタンス。生成時に
 *   確定する個体ではなく、定義の時点で名前の分かっている場所（外洋・本土、`Voyage.md`）を指すためのもの。
 *
 * 解決できない場合（プロパティを持たない・そのIDの個体が世界のどこにも居ない・その型が世界に居ない）は
 * undefinedで、呼び出し側は「解決できない適用は無視」の既存規約（9.1節）に従う。
 */
export class ObjectRef {
  /** 対象キーで指す参照ならその起点、それ以外はundefined。 */
  private readonly root: ReferenceRoot | undefined;

  /** プロパティで指す参照ならその参照、それ以外はundefined。 */
  private readonly path: PropertyPath | undefined;

  /** 型で指す参照ならそのobject_defのグローバルID、それ以外はundefined。 */
  private readonly objectGlobalId: number | undefined;

  private constructor(
    root: ReferenceRoot | undefined,
    path: PropertyPath | undefined,
    objectGlobalId?: number,
  ) {
    this.root = root;
    this.path = path;
    this.objectGlobalId = objectGlobalId;
  }

  static ofRoot(root: ReferenceRoot): ObjectRef {
    return new ObjectRef(root, undefined);
  }

  static ofProperty(path: PropertyPath): ObjectRef {
    return new ObjectRef(undefined, path);
  }

  static ofObjectDef(objectGlobalId: number): ObjectRef {
    return new ObjectRef(undefined, undefined, objectGlobalId);
  }

  /**
   * 今の文脈で指している相手。プロパティで指す参照は、所属ツリーの根から実効値と同じinstanceIdを
   * 持つ子孫を探す（`move`の`to_prop`が移動先を引くのと同じ引き方）。型で指す参照は、同じ根から
   * その型のインスタンスを探す。
   */
  resolve(context: ReferenceContext): WorldObject | undefined {
    if (this.root !== undefined) return context.objectAt(this.root);

    const owner = context.self;
    if (owner === undefined) return undefined;
    if (this.objectGlobalId !== undefined) return owner.findRoot().findDescendantOfDef(this.objectGlobalId);

    const instanceId = this.path!.number(context);
    if (instanceId === undefined) return undefined;
    return owner.findRoot().findDescendantByInstanceId(instanceId);
  }

  /** この参照の宣言そのもの（ObjectRefReading参照）。 */
  get reading(): ObjectRefReading {
    if (this.root !== undefined) return { kind: 'root', root: this.root };
    if (this.objectGlobalId !== undefined) return { kind: 'object', objectGlobalId: this.objectGlobalId };
    return { kind: 'property', subject: this.path!.root, propertyGlobalId: this.path!.propertyGlobalId };
  }
}
