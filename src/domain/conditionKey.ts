import type {
  ConditionDeclaration,
  ConditionOp,
  ConditionReader,
  PropertyConditionReading,
} from './ConditionReader';
import { NEGATED_OPS, propertyValueName } from './conditionWords';
import type { StageBound } from './PropertyDef';
import type { ReferenceRoot } from './ReferenceRoot';
import type { TypeMatchReading } from './TypeMatchRule';
import type { WorldCodex } from './WorldCodex';
import type { PropertyGlobalId, SlotGlobalId } from './GlobalId';

/**
 * 条件（14節）の宣言に与える、**言語によらない正準な鍵**。
 *
 * 「同じ条件か」を、日本語の文（[`conditionWords`](./conditionWords.ts)）を経由せずに答える手立て。
 * 文は読み手へ見せるためのもので、**同一性の担い手にはできない**——言い回しを変えるだけで、同じ条件が
 * 別のものになってしまう。行の名前・生成物の値・文書がセルを名指す鍵は、こちらが担う。
 *
 * 鍵に出るのは**定義が書いている識別子だけ**（プロパティ・スロット・タグ・型の名前と、段の名前）。
 * 前置記法で、**空白を1つも含まない**——引用印のセレクタ値（`condition=...`）が引用符なしで書ける。
 *
 * **畳み方は文と揃えてある**——否定は葉まで押し下げ（ド・モルガンの法則）、子が1つだけの
 * `all`・`any`はその子そのものにする。揃えないと、同じ文になる条件に別の鍵が付き、見た目が
 * 区別できない行が2つ並ぶ。
 */
export function conditionKey(codex: WorldCodex, condition: ConditionDeclaration): string {
  return keyOf(condition, codex, false);
}

function keyOf(condition: ConditionDeclaration, codex: WorldCodex, negated: boolean): string {
  const writer = new ConditionKeyWriter(codex, negated);
  condition.readBy(writer);
  return writer.key;
}

/** 段を名指した葉（14.1節）の綴り。ちょうどその段か、その段以上か。 */
const STAGE_KEYS: Readonly<Record<StageBound, string>> = {
  exact: 'in_stage',
  or_above: 'in_stage_or_above',
};

class ConditionKeyWriter implements ConditionReader {
  key = '';

  private readonly codex: WorldCodex;

  /** ここまでの否定を畳んだ結果。真なら、葉を否定形で綴る（ConditionWordWriterと同じ）。 */
  private readonly negated: boolean;

  constructor(codex: WorldCodex, negated: boolean) {
    this.codex = codex;
    this.negated = negated;
  }

  property(reading: PropertyConditionReading): void {
    const op: ConditionOp = this.negated ? NEGATED_OPS[reading.op] : reading.op;
    this.key = `${op}(${this.propertyRef(reading.root, reading.propertyGlobalId)},${this.valueKey(reading)})`;
  }

  propertyStage(
    root: ReferenceRoot,
    propertyGlobalId: PropertyGlobalId,
    stageName: string,
    bound: StageBound,
  ): void {
    const name = `${this.negated ? 'not_' : ''}${STAGE_KEYS[bound]}`;
    this.key = `${name}(${this.propertyRef(root, propertyGlobalId)},${stageName})`;
  }

  slotPosition(root: ReferenceRoot, slotGlobalId: SlotGlobalId): void {
    const name = this.negated ? 'not_in_slot' : 'in_slot';
    this.key = `${name}(${root},${this.codex.slotNames.getName(slotGlobalId)})`;
  }

  slotContent(root: ReferenceRoot, slotGlobalId: SlotGlobalId, match: TypeMatchReading): void {
    const name = this.negated ? 'slot_lacks' : 'slot_has';
    const slot = this.codex.slotNames.getName(slotGlobalId);
    this.key = `${name}(${root},${slot},${this.typeMatchKey(match)})`;
  }

  objectMatches(root: ReferenceRoot, match: TypeMatchReading): void {
    const name = this.negated ? 'is_not' : 'is';
    this.key = `${name}(${root},${this.typeMatchKey(match)})`;
  }

  all(children: readonly ConditionDeclaration[]): void {
    this.join(children, this.negated ? 'any' : 'all');
  }

  any(children: readonly ConditionDeclaration[]): void {
    this.join(children, this.negated ? 'all' : 'any');
  }

  not(child: ConditionDeclaration): void {
    this.key = keyOf(child, this.codex, !this.negated);
  }

  /**
   * 子を並べる。**子が1つだけなら包まない**——「これ1つがすべて成立している」はその子そのもので、
   * 文（ConditionWordWriter.join）もそう書く。
   */
  private join(children: readonly ConditionDeclaration[], name: string): void {
    const keys = children.map((child) => keyOf(child, this.codex, this.negated));
    this.key = keys.length === 1 ? keys[0] : `${name}(${keys.join(',')})`;
  }

  /** 主語とプロパティ。**selfも綴る**——文と違い、鍵では省いた主語を読み手が補えない。 */
  private propertyRef(root: ReferenceRoot, propertyGlobalId: PropertyGlobalId): string {
    return `${root}.${this.codex.propertyNames.getName(propertyGlobalId)}`;
  }

  /** 型の指定（4.1節）。タグと型はIDの空間が別なので、種類を前置きして混ぜない。 */
  private typeMatchKey(match: TypeMatchReading): string {
    switch (match.kind) {
      case 'tag':
        return `tag:${this.codex.tagNames.getName(match.tagGlobalId)}`;
      case 'object':
        return `object:${this.codex.objectNames.getName(match.objectGlobalId)}`;
      case 'not':
        return `not(${this.typeMatchKey(match.inner)})`;
    }
  }

  /** 比較の相手。別のプロパティを見ているなら`@`を前置きして、同じ綴りのリテラルと紛れさせない。 */
  private valueKey(reading: PropertyConditionReading): string {
    const { valueRef } = reading;
    if (valueRef !== undefined) return `@${this.propertyRef(valueRef.root, valueRef.propertyGlobalId)}`;

    return (reading.values ?? [])
      .map((value) => propertyValueName(this.codex, reading.propertyGlobalId, value))
      .join('|');
  }
}
