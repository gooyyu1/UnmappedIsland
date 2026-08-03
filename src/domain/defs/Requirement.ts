import type { WorldObject } from '../runtime/WorldObject';
import type { ConditionNode } from './ConditionNode';
import type { ReferenceRoot } from './ReferenceRoot';

/**
 * actions/combinationsの`conditions`（14節）の要素1つ。
 *
 * 満たさなかったときにプレイヤーへ出す理由を`reason`（識別子）で指せる。条件木の形から文を組み立てず、
 * 「この要件を満たしていない」という単位で著者が書いた1行を出すのは、否定・入れ子の入った木を
 * どの言語でも自然な文にする一般的な方法が無いため（文言はlocaleが持つ、Localization.md）。
 */
export class Requirement {
  readonly node: ConditionNode;

  /** localeのreason_textsを引く識別子。宣言が無ければundefined（理由を出さない要件）。 */
  readonly reasonName: string | undefined;

  constructor(node: ConditionNode, reasonName: string | undefined) {
    this.node = node;
    this.reasonName = reasonName;
  }
}

/** 1つの操作を実行するために満たすべき要件一式（宣言順・暗黙のAND）。 */
export class Requirements {
  private readonly entries: readonly Requirement[];

  constructor(entries: readonly Requirement[]) {
    this.entries = entries;
  }

  /**
   * 宣言順で最初に満たしていない要件。すべて満たしていればundefined（＝実行できる）。
   * 実行可否と「なぜできないか」が同じ1回の評価から出るので、呼び出し側は2度評価しなくてよい。
   */
  firstUnmet(resolveRoot: (root: ReferenceRoot) => WorldObject | undefined): Requirement | undefined {
    return this.entries.find((entry) => !entry.node.evaluate(resolveRoot));
  }
}
