import type { StackOrderReading } from '../../domain/StackOrderDef';
import type { DefNames, DescriptionToken } from './Description';
import { propertyRef, text } from './Description';

/** スタックの並び順（StackOrderDef）を書き表す。 */
export function stackOrderTokens(reading: StackOrderReading, names: DefNames): readonly DescriptionToken[] {
  return [
    propertyRef(names.propertyName(reading.propertyGlobalId)),
    text(reading.ascending ? 'の昇順' : 'の降順'),
  ];
}
