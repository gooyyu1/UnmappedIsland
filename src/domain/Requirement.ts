import type { ConditionNode } from './ConditionNode';
import type { ConditionDeclaration } from './ConditionReader';
import type { ReferenceContext } from './ReferenceRoot';

/**
 * 要件の並び（14.6節）の要素1つ。
 *
 * 満たさなかったときにプレイヤーへ出す理由を`reason`（識別子）で指せる。条件木の形から文を組み立てず、
 * 「この要件を満たしていない」という単位で著者が書いた1行を出すのは、否定・入れ子の入った木を
 * どの言語でも自然な文にする一般的な方法が無いため（文言はlocaleが持つ、Localization.md）。
 */
export class Requirement {
  private readonly node: ConditionNode;

  /** localeのreason_textsを引く識別子。宣言が無ければundefined（理由を出さない要件）。 */
  readonly reasonName: string | undefined;

  constructor(node: ConditionNode, reasonName: string | undefined) {
    this.node = node;
    this.reasonName = reasonName;
  }

  /** この要件が書いている条件（ConditionReader参照）。 */
  get condition(): ConditionDeclaration {
    return this.node;
  }

  /** 今この文脈でこの要件を満たしているか。 */
  isMet(context: ReferenceContext): boolean {
    return this.node.evaluate(context);
  }
}

/** 1つの操作を実行するために満たすべき要件一式（宣言順・暗黙のAND）。 */
export class Requirements {
  /** 宣言順の要件（読み上げは呼び出し側が行う）。 */
  readonly declarations: readonly Requirement[];

  constructor(entries: readonly Requirement[]) {
    this.declarations = entries;
  }

  /**
   * 宣言順で最初に満たしていない要件。すべて満たしていればundefined（＝実行できる）。
   * 実行可否と「なぜできないか」が同じ1回の評価から出るので、呼び出し側は2度評価しなくてよい。
   */
  firstUnmet(context: ReferenceContext): Requirement | undefined {
    return this.declarations.find((entry) => !entry.isMet(context));
  }
}
