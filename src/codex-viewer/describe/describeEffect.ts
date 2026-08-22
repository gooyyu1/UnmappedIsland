import type { DefNames, DescriptionToken, DescriptionWriter } from './Description';
import { objectRef, propertyRef, signalRef, signedNumber, slotRef, text } from './Description';
import type {
  EffectDeclaration,
  EffectReader,
  AddReading,
  PickCandidateReading,
  TransferReading,
  WeightReading,
} from '../../domain/EffectReader';
import type { ObjectRefReading } from '../../domain/ObjectRef';
import type { ReferenceRoot } from '../../domain/ReferenceRoot';

/**
 * 効果の宣言（EffectReader）を、読める形へ書き出す（Description参照）。命令1つにつき1行で、
 * 入れ子（pickの候補・linked_add）は字下げする。
 *
 * **書き出しも読み手の1つ**にしてある。効果クラスごとに`describe`を持たせると、動詞を1つ足すたびに
 * 「書き出す」「どのプロパティを動かすか」「何を生むか」の3箇所へ同じ木を辿るコードが増える。
 * 読み上げ口（`read`）を1つに絞れば、増えるのは動詞1つぶんの受け口だけで済む。
 */
export function describeEffect(
  declaration: EffectDeclaration,
  names: DefNames,
  out: DescriptionWriter,
): void {
  declaration.read(new EffectDescriber(names, out));
}

/**
 * `add`の1行（`add 満腹度(actor) +20`）。tick毎の持続効果（8.4節）も同じ形で書くので、断片で返す。
 */
export function addTokens(
  target: ReferenceRoot,
  propertyGlobalId: number,
  amount: number,
  verb: string,
  names: DefNames,
): readonly DescriptionToken[] {
  return [
    text(`${verb} `),
    propertyRef(names.propertyName(propertyGlobalId), target),
    text(` ${signedNumber(amount)}`),
  ];
}

/** `transfer`の1行。tick毎の輸送（8.4節）も同じ形で書くので、断片で返す。 */
export function transferTokens(reading: TransferReading, names: DefNames): readonly DescriptionToken[] {
  const tokens: DescriptionToken[] = [
    text('transfer '),
    propertyRef(names.propertyName(reading.fromPropertyGlobalId), reading.from),
    text(' → '),
    propertyRef(names.propertyName(reading.toPropertyGlobalId), reading.to),
    text(`（最大${reading.amount}`),
  ];
  // 単位が違う移送（水のmL → 水分のtick数）だけ、受け取る側の量も書く。
  if (reading.toAmount !== reading.amount) tokens.push(text(` → ${reading.toAmount}`));
  tokens.push(text('）'));
  return tokens;
}

/** `linked_add`の1行（輸送の下に字下げして並べる）。 */
export function linkedAddTokens(linked: AddReading, names: DefNames): readonly DescriptionToken[] {
  return [
    ...addTokens(linked.target, linked.propertyGlobalId, linked.amount, 'add', names),
    text('（実際に移した量に比例）'),
  ];
}

/** オブジェクトを指す参照の書き表し（`destroy`の対象・`move`の両端）。 */
function objectRefTokens(reading: ObjectRefReading, names: DefNames): readonly DescriptionToken[] {
  switch (reading.kind) {
    case 'root':
      return [text(reading.root)];
    case 'object':
      return [objectRef(names.objectName(reading.objectGlobalId))];
    case 'property':
      return [propertyRef(names.propertyName(reading.propertyGlobalId), 'self')];
  }
}

/** 重み・所要時間の書き表し。リテラルなら数値、参照ならプロパティ。 */
export function weightTokens(reading: WeightReading, names: DefNames): readonly DescriptionToken[] {
  return reading.kind === 'literal'
    ? [text(String(reading.value))]
    : [propertyRef(names.propertyName(reading.propertyGlobalId), reading.subject)];
}

/** 読み上げをそのまま行へ落とす読み手。 */
class EffectDescriber implements EffectReader {
  private readonly names: DefNames;
  private readonly out: DescriptionWriter;

  constructor(names: DefNames, out: DescriptionWriter) {
    this.names = names;
    this.out = out;
  }

  set(target: ReferenceRoot, propertyGlobalId: number, value: number): void {
    this.out.write(
      text('set '),
      propertyRef(this.names.propertyName(propertyGlobalId), target),
      text(' = '),
      this.names.propertyValue(propertyGlobalId, value),
    );
  }

  add(reading: AddReading): void {
    this.out.write(...addTokens(reading.target, reading.propertyGlobalId, reading.amount, 'add', this.names));
  }

  /** 配置先（`into`）は書かない——どこの枠へ入るかは、何が起きたかの説明には要らない。 */
  spawn(objectGlobalId: number, count: number): void {
    const tokens = [text('spawn '), objectRef(this.names.objectName(objectGlobalId))];
    if (count !== 1) tokens.push(text(` ×${count}`));
    this.out.write(...tokens);
  }

  destroy(target: ObjectRefReading): void {
    this.out.write(text('destroy '), ...objectRefTokens(target, this.names));
  }

  /**
   * 行き先は座標なので、動かす軸とその値をそのまま書く（9.9節）。**どの型になるかは書かない**
   * ——対象が今居る座標との組み合わせで決まるので、宣言だけでは1つに定まらない。
   */
  become(subject: ObjectRefReading, axisValues: ReadonlyMap<string, string>): void {
    const axes = [...axisValues].map(([axis, value]) => `${axis}: ${value}`).join(', ');
    this.out.write(text('become '), ...objectRefTokens(subject, this.names), text(` {${axes}}`));
  }

  transfer(reading: TransferReading): void {
    this.out.write(...transferTokens(reading, this.names));
    if (reading.linked.length === 0) return;
    this.out.indented(() => {
      for (const linked of reading.linked) this.out.write(...linkedAddTokens(linked, this.names));
    });
  }

  move(subject: ObjectRefReading, destination: ObjectRefReading, slotGlobalId: number | undefined): void {
    this.out.write(
      text('move '),
      ...objectRefTokens(subject, this.names),
      text(' → '),
      ...objectRefTokens(destination, this.names),
      ...(slotGlobalId === undefined ? [] : [text('.'), slotRef(this.names.slotName(slotGlobalId))]),
    );
  }

  signal(name: string): void {
    this.out.write(text('signal '), signalRef(name));
  }

  pick(candidates: readonly PickCandidateReading[]): void {
    this.out.write(text('pick:'));
    this.out.indented(() => {
      for (const candidate of candidates) {
        this.out.write(text('weight = '), ...weightTokens(candidate.weight, this.names));
        this.out.indented(() => describeEffect(candidate.effect, this.names, this.out));
      }
    });
  }
}
