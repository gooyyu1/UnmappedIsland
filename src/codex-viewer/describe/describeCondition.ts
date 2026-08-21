import type { ConditionNode, ConditionOp } from '../../domain/ConditionNode';
import type { ConditionReader, PropertyConditionReading } from '../../domain/ConditionReader';
import type { ReferenceRoot } from '../../domain/ReferenceRoot';
import type { TypeMatchReading } from '../../domain/TypeMatchRule';
import type { DefNames, DescriptionToken } from './Description';
import { propertyRef, slotRef, stageRef, text } from './Description';
import { describeTypeMatch } from './describeTypeMatch';

/** 比較演算子の書き表し方。 */
const OP_SYMBOLS: Readonly<Record<ConditionOp, string>> = {
  lt: '<',
  lte: '<=',
  gt: '>',
  gte: '>=',
  eq: '==',
  neq: '!=',
  in: 'in',
  not_in: 'not in',
};

/**
 * 条件（14節）を読める形に書き表す。1つの式なので行に分けず、断片の並びを返す。
 * 複合ノード（all/any/not）は括弧で包み、入れ子の切れ目が読み取れるようにする。
 */
export function describeCondition(node: ConditionNode, names: DefNames): readonly DescriptionToken[] {
  const describer = new ConditionDescriber(names);
  node.read(describer);
  return describer.tokens;
}

class ConditionDescriber implements ConditionReader {
  tokens: readonly DescriptionToken[] = [];

  private readonly names: DefNames;

  constructor(names: DefNames) {
    this.names = names;
  }

  property(reading: PropertyConditionReading): void {
    const tokens: DescriptionToken[] = [
      propertyRef(this.names.propertyName(reading.propertyGlobalId), reading.root),
      text(` ${OP_SYMBOLS[reading.op]} `),
    ];

    if (reading.valueRef !== undefined) {
      tokens.push(
        propertyRef(this.names.propertyName(reading.valueRef.propertyGlobalId), reading.valueRef.root),
      );
      this.tokens = tokens;
      return;
    }

    const values = (reading.values ?? []).map((value) =>
      this.names.propertyValue(reading.propertyGlobalId, value),
    );
    const isList = reading.op === 'in' || reading.op === 'not_in';
    if (isList) tokens.push(text('['));
    for (const [index, value] of values.entries()) {
      if (index > 0) tokens.push(text(', '));
      tokens.push(value);
    }
    if (isList) tokens.push(text(']'));
    this.tokens = tokens;
  }

  propertyStage(root: ReferenceRoot, propertyGlobalId: number, stageName: string): void {
    this.tokens = [
      propertyRef(this.names.propertyName(propertyGlobalId), root),
      text('が段'),
      stageRef(stageName),
      text('にある'),
    ];
  }

  slotPosition(root: ReferenceRoot, slotGlobalId: number): void {
    this.tokens = [
      text(`${root}が`),
      slotRef(this.names.slotName(slotGlobalId)),
      text('スロットに入っている'),
    ];
  }

  slotContent(root: ReferenceRoot, slotGlobalId: number, match: TypeMatchReading): void {
    this.tokens = [
      text(`${root}の`),
      slotRef(this.names.slotName(slotGlobalId)),
      text('スロットに'),
      ...describeTypeMatch(match, this.names),
      text('が入っている'),
    ];
  }

  objectMatches(root: ReferenceRoot, match: TypeMatchReading): void {
    this.tokens = [text(`${root}が`), ...describeTypeMatch(match, this.names), text('である')];
  }

  all(children: readonly ConditionNode[]): void {
    this.tokens = this.joined(children, 'かつ');
  }

  any(children: readonly ConditionNode[]): void {
    this.tokens = this.joined(children, 'または');
  }

  not(child: ConditionNode): void {
    this.tokens = [text('not '), ...describeCondition(child, this.names)];
  }

  private joined(children: readonly ConditionNode[], conjunction: string): readonly DescriptionToken[] {
    const tokens: DescriptionToken[] = [text('(')];
    for (const [index, child] of children.entries()) {
      if (index > 0) tokens.push(text(` ${conjunction} `));
      tokens.push(...describeCondition(child, this.names));
    }
    tokens.push(text(')'));
    return tokens;
  }
}
