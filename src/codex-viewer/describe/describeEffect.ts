import type { DefNames, DescriptionToken, DescriptionWriter } from './Description';
import {
  destroyReasonRef,
  objectRef,
  propertyPathRef,
  signalRef,
  signedNumber,
  slotRef,
  text,
} from './Description';
import type {
  EffectDeclaration,
  EffectReader,
  AddReading,
  PickCandidateReading,
  SetValueReading,
  TransferReading,
  DeclaredNumberReading,
} from '../../domain/EffectReader';
import { multipliedRefs } from '../../domain/EffectReader';
import type { AmongReading } from '../../domain/AmongSpec';
import type { ObjectRefReading } from '../../domain/ObjectRef';
import { typeMatchTokens } from './typeMatchTokens';
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
 * `add`の1行（`add 満腹度(agent) +20`）。tick毎の持続効果（8.4節）も同じ形で書くので、断片で返す。
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
    propertyPathRef(names.propertyName(propertyGlobalId), target),
    text(` ${signedNumber(amount)}`),
  ];
}

/** `transfer`の1行。tick毎の輸送（8.4節）も同じ形で書くので、断片で返す。 */
export function transferTokens(reading: TransferReading, names: DefNames): readonly DescriptionToken[] {
  const tokens: DescriptionToken[] = [
    text('transfer '),
    propertyPathRef(names.propertyName(reading.fromPropertyGlobalId), reading.from),
    text(' → '),
    propertyPathRef(names.propertyName(reading.toPropertyGlobalId), reading.to),
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
      return [propertyPathRef(names.propertyName(reading.propertyGlobalId), 'self')];
    // 型で指す相手を、名前ではなくプロパティから引く形（6.9節）。指すのが個体ではなく型であることは、
    // 引くプロパティの名前だけでは読めないので添える。
    case 'object_property':
      return [propertyPathRef(names.propertyName(reading.propertyGlobalId), 'self'), text('が名乗る型')];
  }
}

/** 重み・所要時間の書き表し。リテラルなら数値、参照ならプロパティ、積なら「× 」で繋いだ2つ。 */
export function declaredNumberTokens(
  reading: DeclaredNumberReading,
  names: DefNames,
): readonly DescriptionToken[] {
  if (reading.kind === 'literal') return [text(String(reading.value))];

  return multipliedRefs(reading).flatMap((ref, index) => [
    ...(index === 0 ? [] : [text(' × ')]),
    propertyPathRef(names.propertyName(ref.propertyGlobalId), ref.subject),
  ]);
}

/** `among`（10.3節）の1行。どこから・どう絞って・どんな重みで1つ選ぶか。 */
function amongTokens(reading: AmongReading, names: DefNames): readonly DescriptionToken[] {
  return [
    text(`among ${reading.root}.`),
    slotRef(names.slotName(reading.slotGlobalId)),
    ...(reading.match === undefined ? [] : [text(' の '), ...typeMatchTokens(reading.match, names)]),
    text(' から1つ'),
    ...(reading.weight === undefined
      ? [text('（一律）')]
      : [text('（重み: '), ...declaredNumberTokens(reading.weight, names), text('）')]),
  ];
}

/** 読み上げをそのまま行へ落とす読み手。 */
class EffectDescriber implements EffectReader {
  private readonly names: DefNames;
  private readonly out: DescriptionWriter;

  constructor(names: DefNames, out: DescriptionWriter) {
    this.names = names;
    this.out = out;
  }

  set(target: ReferenceRoot, propertyGlobalId: number, value: SetValueReading): void {
    this.out.write(
      text('set '),
      propertyPathRef(this.names.propertyName(propertyGlobalId), target),
      text(' = '),
      ...(typeof value === 'number'
        ? [this.names.propertyValueToken(propertyGlobalId, value)]
        : objectRefTokens(value, this.names)),
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

  /** 消し方の名乗り（`reason`、9.3節）まで書く——名乗らない消滅と見分けが付くのは、この名前だけ。 */
  destroy(target: ObjectRefReading, reason: string | undefined): void {
    this.out.write(
      text('destroy '),
      ...objectRefTokens(target, this.names),
      ...(reason === undefined ? [] : [text('（消し方: '), destroyReasonRef(reason), text('）')]),
    );
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
        this.out.write(text('weight = '), ...declaredNumberTokens(candidate.weight, this.names));
        this.out.indented(() => {
          if (candidate.among !== undefined) this.out.write(...amongTokens(candidate.among, this.names));
          describeEffect(candidate.effect, this.names, this.out);
        });
      }
    });
  }
}
