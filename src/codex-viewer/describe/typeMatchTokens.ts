import type { TypeMatchReading } from '../../domain/TypeMatchRule';
import type { DefNames, DescriptionToken } from './Description';
import { objectRef, tagRef, text } from './Description';

/** 「どの型が当てはまるか」の指定（4.1節）を書き表す。 */
export function typeMatchTokens(reading: TypeMatchReading, names: DefNames): readonly DescriptionToken[] {
  return reading.kind === 'tag'
    ? [tagRef(names.tagName(reading.tagGlobalId)), text('を持つ型')]
    : [objectRef(names.objectName(reading.objectGlobalId)), text('そのもの')];
}
