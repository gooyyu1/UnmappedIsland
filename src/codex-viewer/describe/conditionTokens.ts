import type { ConditionDeclaration } from '../../domain/ConditionReader';
import { conditionWords } from '../../domain/conditionWords';
import type { DefNames, DescriptionToken } from './Description';
import { objectRef, propertyRef, slotRef, stageRef, tagRef, text } from './Description';

/**
 * 条件（14節）を読める形に書き表す。1つの式なので行に分けず、断片の並びを返す。
 *
 * **文の形を決めるのはドメインの[`conditionWords`](../../domain/conditionWords.ts)**で、ここが担うのは
 * 識別子を参照の断片（リンクを張れる）へ戻すところだけ。収支の表（`stats/balance.yaml`）と同じ文が
 * 出る（issue #987）。
 */
export function conditionTokens(node: ConditionDeclaration, names: DefNames): readonly DescriptionToken[] {
  return conditionWords<DescriptionToken>(node, {
    text,
    // 起点は文の主語として語で出ているので接頭辞には出さない。リンク先の持ち主を決めるのには要る。
    property: (globalId, root) => propertyRef(names.propertyName(globalId), root),
    propertyValue: (propertyGlobalId, value) => names.propertyValueToken(propertyGlobalId, value),
    slot: (globalId) => slotRef(names.slotName(globalId)),
    tag: (globalId) => tagRef(names.tagName(globalId)),
    object: (globalId) => objectRef(names.objectName(globalId)),
    stage: stageRef,
  });
}
