import type { CellDef, SlotDef } from '../../domain/SlotDef';
import type { DefNames, DescriptionToken, DescriptionWriter } from './Description';
import { text } from './Description';
import { declaredNumberTokens } from './describeEffect';
import { typeMatchTokens } from './typeMatchTokens';

/** 枠1つが受け入れる型（7.2節）を書き表す。 */
function cellTokens(cell: CellDef, names: DefNames): readonly DescriptionToken[] {
  const tokens: DescriptionToken[] = [
    ...(cell.accept === undefined ? [text('どんな型でも')] : typeMatchTokens(cell.accept.reading, names)),
  ];
  if (cell.max !== undefined) tokens.push(text(`（同種は${cell.max}個まで）`));
  return tokens;
}

/**
 * スロットが受け入れる型を書き出す。枠ごとに違う要件を書けるため、枠の内訳は位置ごとに違うときだけ
 * 位置を添えて並べる（同じなら1行で足りる）。
 */
export function describeAccept(slot: SlotDef, names: DefNames, out: DescriptionWriter): void {
  const reading = slot.cellsReading;
  if (reading.kind === 'uniform') {
    out.write(...cellTokens(reading.cell, names));
    return;
  }
  for (const [index, cell] of reading.cells.entries())
    out.write(text(`${index + 1}枠目: `), ...cellTokens(cell, names));
}

/** ここへ物を入れるのにかかる時間（7.10節）の書き表し。宣言が無ければundefined（一瞬で入る）。 */
export function putInDurationTokens(slot: SlotDef, names: DefNames): readonly DescriptionToken[] | undefined {
  const reading = slot.putInDurationReading;
  return reading === undefined ? undefined : declaredNumberTokens(reading, names);
}
