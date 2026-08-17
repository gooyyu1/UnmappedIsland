import type { EffectDeclaration, EffectReader, PickCandidateReading, TransferReading } from './EffectReader';
import type { ObjectRef } from './ObjectRef';
import type { ReferenceRoot } from './ReferenceRoot';

/**
 * 効果の宣言に対する逆引き（「このプロパティを書き換えるのは誰か」「これを生むのは誰か」）。
 *
 * どれも読み上げ口（`read`）越しに答える。**問いごとに効果クラスへメソッドを生やさない**——
 * 型11 × 問いの数だけ交差点が増え、動詞を1つ足したときの書き忘れが黙って通るため。
 */

/**
 * この宣言がpropertyGlobalIdのプロパティを書き換えうるか。
 *
 * ownedByDeclarerは、そのプロパティが宣言元のobject_def自身のものか。target=selfの効果は宣言元自身の
 * プロパティしか書き換えないため、他の型の同名プロパティは書き換え対象にならない。
 */
export function writesToProperty(
  declaration: EffectDeclaration,
  propertyGlobalId: number,
  ownedByDeclarer: boolean,
): boolean {
  const reader = new PropertyWriterFinder(propertyGlobalId, ownedByDeclarer);
  declaration.read(reader);
  return reader.found;
}

/** この宣言がobjectGlobalIdの型を生み出しうるか。生むのは`spawn`（9.4節）だけ。 */
export function spawnsObject(declaration: EffectDeclaration, objectGlobalId: number): boolean {
  const reader = new SpawnFinder(objectGlobalId);
  declaration.read(reader);
  return reader.found;
}

/** 動詞を1つも見ない読み手。探し物を持つ具象が、要る受け口だけを上書きする。 */
abstract class Finder implements EffectReader {
  found = false;

  set(_target: ReferenceRoot, _propertyGlobalId: number, _value: number): void {}
  add(_target: ReferenceRoot, _propertyGlobalId: number, _amount: number): void {}
  spawn(_objectGlobalId: number, _count: number): void {}
  destroy(_target: ObjectRef): void {}
  transfer(_reading: TransferReading): void {}
  move(_subject: ObjectRef, _destination: ObjectRef): void {}
  signal(_name: string): void {}

  /** 候補の奥にあるものも数える（pickは分岐でしかなく、起こることを隠さない）。 */
  pick(candidates: readonly PickCandidateReading[]): void {
    for (const candidate of candidates) candidate.effect.read(this);
  }
}

class PropertyWriterFinder extends Finder {
  private readonly propertyGlobalId: number;
  private readonly ownedByDeclarer: boolean;

  constructor(propertyGlobalId: number, ownedByDeclarer: boolean) {
    super();
    this.propertyGlobalId = propertyGlobalId;
    this.ownedByDeclarer = ownedByDeclarer;
  }

  override set(target: ReferenceRoot, propertyGlobalId: number): void {
    this.check(target, propertyGlobalId);
  }

  override add(target: ReferenceRoot, propertyGlobalId: number): void {
    this.check(target, propertyGlobalId);
  }

  override transfer(reading: TransferReading): void {
    this.check(reading.from, reading.fromPropertyGlobalId);
    this.check(reading.to, reading.toPropertyGlobalId);
    for (const linked of reading.linked) this.check(linked.target, linked.propertyGlobalId);
  }

  private check(target: ReferenceRoot, propertyGlobalId: number): void {
    if (propertyGlobalId !== this.propertyGlobalId) return;
    if (this.ownedByDeclarer || target !== 'self') this.found = true;
  }
}

class SpawnFinder extends Finder {
  private readonly objectGlobalId: number;

  constructor(objectGlobalId: number) {
    super();
    this.objectGlobalId = objectGlobalId;
  }

  override spawn(objectGlobalId: number): void {
    if (objectGlobalId === this.objectGlobalId) this.found = true;
  }
}
