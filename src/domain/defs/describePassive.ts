import type { DefNames, DescriptionToken, DescriptionWriter } from './Description';
import { propertyRef, stageRef, text } from './Description';
import { addTokens, linkedAddTokens, transferTokens } from './describeEffect';
import type { TransferReading } from './EffectReader';
import type { GateReading, PassiveDeclaration, PassivePropertyReading, PassiveReader } from './PassiveReader';

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

/** その持続効果がpropertyGlobalIdのプロパティを書き換えうるか（writesToProperty の持続効果版）。 */
export function passiveWritesToProperty(
  declaration: PassiveDeclaration,
  propertyGlobalId: number,
  ownedByDeclarer: boolean,
): boolean {
  const reader = new PassivePropertyWriterFinder(propertyGlobalId, ownedByDeclarer);
  declaration.read(reader);
  return reader.found;
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
    tokens.push(...gate.conditions.describe(names));
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
    const tokens = [...addTokens(reading.target, reading.propertyGlobalId, reading.amount, this.names, verb)];
    const gate = gateTokens(reading.gate, this.names);
    if (gate.length > 0) tokens.push(text('（'), ...gate, text('間）'));
    this.out.write(...tokens);
  }
}

class PassivePropertyWriterFinder implements PassiveReader {
  found = false;

  private readonly propertyGlobalId: number;
  private readonly ownedByDeclarer: boolean;

  constructor(propertyGlobalId: number, ownedByDeclarer: boolean) {
    this.propertyGlobalId = propertyGlobalId;
    this.ownedByDeclarer = ownedByDeclarer;
  }

  modify(reading: PassivePropertyReading): void {
    this.check(reading.target, reading.propertyGlobalId);
  }

  accumulate(reading: PassivePropertyReading): void {
    this.check(reading.target, reading.propertyGlobalId);
  }

  transfer(reading: TransferReading): void {
    this.check(reading.from, reading.fromPropertyGlobalId);
    this.check(reading.to, reading.toPropertyGlobalId);
    for (const linked of reading.linked) this.check(linked.target, linked.propertyGlobalId);
  }

  private check(target: string, propertyGlobalId: number): void {
    if (propertyGlobalId !== this.propertyGlobalId) return;
    if (this.ownedByDeclarer || target !== 'self') this.found = true;
  }
}
