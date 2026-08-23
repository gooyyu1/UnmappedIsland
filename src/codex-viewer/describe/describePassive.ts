import type { DefNames, DescriptionToken, DescriptionWriter } from './Description';
import { conditionTokens } from './conditionTokens';
import { propertyRef, stageRef, text } from './Description';
import { addTokens, linkedAddTokens, transferTokens } from './describeEffect';
import type { TransferReading } from '../../domain/EffectReader';
import type {
  GateReading,
  PassiveDeclaration,
  PassivePropertyReading,
  PassiveReader,
} from '../../domain/PassiveReader';

/**
 * 持続効果の宣言（PassiveReader）を、読める形へ書き出す（Description参照）。1つにつき1行で、
 * ゲート（8.2節）は行末の括弧に添える。
 */
export function describePassive(
  declaration: PassiveDeclaration,
  names: DefNames,
  out: DescriptionWriter,
): void {
  declaration.read(new PassiveDescriber(names, out));
}

/**
 * 寄与の1行。量が定数なら`+40`、宣言元自身のプロパティの積（PassiveAmount）なら
 * `重さ × 体感率 ぶん`と書く。
 */
function amountTokens(
  reading: PassivePropertyReading,
  verb: string,
  names: DefNames,
): readonly DescriptionToken[] {
  if (reading.amount.kind === 'fixed')
    return addTokens(reading.target, reading.propertyGlobalId, reading.amount.value, verb, names);

  const factors: DescriptionToken[] = [];
  for (const globalId of reading.amount.factorPropertyGlobalIds) {
    if (factors.length > 0) factors.push(text(' × '));
    factors.push(propertyRef(names.propertyName(globalId)));
  }
  return [
    text(`${verb} `),
    propertyRef(names.propertyName(reading.propertyGlobalId), reading.target),
    text(' '),
    ...factors,
    text(' ぶん'),
  ];
}

/** ゲートの書き表し。常時有効なら空（条件が無いことを書き足さない）。 */
function gateTokens(gate: GateReading, names: DefNames): readonly DescriptionToken[] {
  const tokens: DescriptionToken[] = [];
  if (gate.stage !== undefined)
    tokens.push(
      propertyRef(names.propertyName(gate.stage.propertyGlobalId)),
      text('が段'),
      stageRef(gate.stage.name),
      text('にある'),
    );

  if (gate.conditions !== undefined) {
    if (tokens.length > 0) tokens.push(text(' かつ '));
    tokens.push(...conditionTokens(gate.conditions, names));
  }
  return tokens;
}

class PassiveDescriber implements PassiveReader {
  private readonly names: DefNames;
  private readonly out: DescriptionWriter;

  constructor(names: DefNames, out: DescriptionWriter) {
    this.names = names;
    this.out = out;
  }

  modify(reading: PassivePropertyReading): void {
    this.writeProperty(reading, 'modify');
  }

  accumulate(reading: PassivePropertyReading): void {
    this.writeProperty(reading, 'add');
  }

  transfer(reading: TransferReading, gate: GateReading): void {
    const tokens = gateTokens(gate, this.names);
    const suffix = tokens.length > 0 ? [text('（'), ...tokens, text('間、tick毎）')] : [text('（tick毎）')];
    this.out.write(...transferTokens(reading, this.names), ...suffix);

    if (reading.linked.length === 0) return;
    this.out.indented(() => {
      for (const linked of reading.linked) this.out.write(...linkedAddTokens(linked, this.names));
    });
  }

  private writeProperty(reading: PassivePropertyReading, verb: string): void {
    const tokens = [...amountTokens(reading, verb, this.names)];
    const gate = gateTokens(reading.gate, this.names);
    if (gate.length > 0) tokens.push(text('（'), ...gate, text('間）'));
    this.out.write(...tokens);
  }
}
