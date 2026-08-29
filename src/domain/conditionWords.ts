import type {
  ConditionDeclaration,
  ConditionOp,
  ConditionReader,
  PropertyConditionReading,
} from './ConditionReader';
import type { ReferenceRoot } from './ReferenceRoot';
import type { TypeMatchReading } from './TypeMatchRule';
import type { WorldCodex } from './WorldCodex';

/**
 * 条件（14節）の文を組み立てる語の作り手。**識別子を語へ戻すのも作り手の仕事**で、読み手ごとに
 * 違うのは語の姿だけ——リンクを張れる断片（データベースビューア）か、識別子のままの平文（収支の表）か。
 *
 * 文の形（記号・括弧・否定の押し下げ・主語の語）はここでは決めない。決めるのは
 * [`conditionWords`](./conditionWords.ts)で、**同じ宣言はどこで読んでも同じ文になる**。
 */
export interface ConditionWordMaker<T> {
  /** 地の文（識別子ではない部分）。 */
  text(value: string): T;

  /**
   * プロパティ参照。**主語を文に出すのは文の側**（下のSUBJECT_WORDS）なので、rootは語ではなく
   * 「どのオブジェクトのプロパティか」として渡す——リンクを張る読み手はこれで持ち主を決める。
   */
  property(globalId: number, root: ReferenceRoot): T;

  /** 比較の相手のリテラル1つ。シンボル型プロパティ（6.6節）の値はシンボル名へ戻す。 */
  propertyValue(propertyGlobalId: number, value: number): T;

  slot(globalId: number): T;
  tag(globalId: number): T;
  object(globalId: number): T;

  /** 段（6.4節）の名前。段は宣言したプロパティごとの名前で、独立した名前空間を持たない。 */
  stage(name: string): T;
}

/**
 * 条件（14節）を1つの文として書き表す。**識別子はそのまま出す**——読み手が定義と引き比べられることが、
 * 条件を見せる理由そのもの（issue #961）。
 *
 * 否定は葉まで押し下げる（ド・モルガンの法則）。`not: {slot: catch, matches: {tag: quarry}}` を
 * 「〜ではない」と包むより、「catch枠にquarryが無い」と書くほうが条件の形と一致する。
 */
export function conditionWords<T>(
  condition: ConditionDeclaration,
  make: ConditionWordMaker<T>,
): readonly T[] {
  return phraseOf(condition, make, false).words;
}

/** 識別子をそのまま並べた平文。表示名もリンクも持たない読み手（収支の表・テスト・ログ）向け。 */
export function conditionText(codex: WorldCodex, condition: ConditionDeclaration): string {
  return conditionWords(condition, plainWordMaker(codex)).join('');
}

/** 比較演算子の書き表し方。YAMLのフロー形式でそのまま書ける記号を選ぶ（引用符が増えない）。 */
const OP_SYMBOLS: Readonly<Record<ConditionOp, string>> = {
  lt: '<',
  lte: '≤',
  gt: '>',
  gte: '≥',
  eq: '=',
  neq: '≠',
  in: '∈',
  not_in: '∉',
};

/** 否定したときの比較演算子。比較の否定は比較なので、否定を葉まで押し下げられる。 */
const NEGATED_OPS: Readonly<Record<ConditionOp, ConditionOp>> = {
  lt: 'gte',
  lte: 'gt',
  gt: 'lte',
  gte: 'lt',
  eq: 'neq',
  neq: 'eq',
  in: 'not_in',
  not_in: 'in',
};

/** 条件の主語を指す語。**selfには語を当てない**——その文はもともとselfの話だから。 */
const SUBJECT_WORDS: Readonly<Record<ReferenceRoot, string>> = {
  self: '',
  parent: '親',
  child: '子',
  agent: '操作者',
  instrument: '重ねた相手',
  picked: '選ばれた相手',
  ancestor: '祖先',
};

/** 書き表した条件。compositeなら、他の条件と並べるときに括弧が要る。 */
interface ConditionPhrase<T> {
  readonly words: readonly T[];
  readonly composite: boolean;
}

function phraseOf<T>(
  condition: ConditionDeclaration,
  make: ConditionWordMaker<T>,
  negated: boolean,
): ConditionPhrase<T> {
  const writer = new ConditionWordWriter(make, negated);
  condition.read(writer);
  return writer;
}

class ConditionWordWriter<T> implements ConditionReader, ConditionPhrase<T> {
  words: readonly T[] = [];

  composite = false;

  private readonly make: ConditionWordMaker<T>;

  /** ここまでの否定を畳んだ結果。真なら、葉を否定形で書く。 */
  private readonly negated: boolean;

  constructor(make: ConditionWordMaker<T>, negated: boolean) {
    this.make = make;
    this.negated = negated;
  }

  property(reading: PropertyConditionReading): void {
    const op = this.negated ? NEGATED_OPS[reading.op] : reading.op;
    this.words = [
      ...this.subject(reading.root, 'の'),
      this.make.property(reading.propertyGlobalId, reading.root),
      this.make.text(` ${OP_SYMBOLS[op]} `),
      ...this.valueWords(reading),
    ];
  }

  propertyStage(root: ReferenceRoot, propertyGlobalId: number, stageName: string): void {
    this.words = [
      ...this.subject(root, 'の'),
      this.make.property(propertyGlobalId, root),
      this.make.text('が段'),
      this.make.stage(stageName),
      this.make.text(this.negated ? 'にない' : 'にある'),
    ];
  }

  slotPosition(root: ReferenceRoot, slotGlobalId: number): void {
    this.words = [
      ...this.subject(root, 'が'),
      this.make.slot(slotGlobalId),
      this.make.text(`枠に${this.negated ? '無い' : 'ある'}`),
    ];
  }

  slotContent(root: ReferenceRoot, slotGlobalId: number, match: TypeMatchReading): void {
    this.words = [
      ...this.subject(root, 'の'),
      this.make.slot(slotGlobalId),
      this.make.text('枠に'),
      ...this.typeMatchWords(match),
      this.make.text(`が${this.negated ? '無い' : 'ある'}`),
    ];
  }

  objectMatches(root: ReferenceRoot, match: TypeMatchReading): void {
    this.words = [
      ...this.subject(root, 'が'),
      ...this.typeMatchWords(match),
      this.make.text(this.negated ? 'でない' : 'である'),
    ];
  }

  all(children: readonly ConditionDeclaration[]): void {
    this.join(children, this.negated ? 'または' : 'かつ');
  }

  any(children: readonly ConditionDeclaration[]): void {
    this.join(children, this.negated ? 'かつ' : 'または');
  }

  not(child: ConditionDeclaration): void {
    const inner = phraseOf(child, this.make, !this.negated);
    this.words = inner.words;
    this.composite = inner.composite;
  }

  /** 入れ子の複合ノードだけを括弧で包む。平らな並びに括弧を足しても、切れ目は増えない。 */
  private join(children: readonly ConditionDeclaration[], conjunction: string): void {
    const words: T[] = [];
    for (const child of children) {
      if (words.length > 0) words.push(this.make.text(` ${conjunction} `));
      const phrase = phraseOf(child, this.make, this.negated);
      if (phrase.composite) words.push(this.make.text('（'), ...phrase.words, this.make.text('）'));
      else words.push(...phrase.words);
    }
    this.words = words;
    this.composite = children.length > 1;
  }

  /** 主語と助詞。selfは語ごと落ちるので助詞も付かない。 */
  private subject(root: ReferenceRoot, particle: string): readonly T[] {
    const word = SUBJECT_WORDS[root];
    return word === '' ? [] : [this.make.text(`${word}${particle}`)];
  }

  /** 型の指定（4.1節）の書き表し方。 */
  private typeMatchWords(match: TypeMatchReading): readonly T[] {
    switch (match.kind) {
      case 'tag':
        return [this.make.tag(match.tagGlobalId)];
      case 'object':
        return [this.make.object(match.objectGlobalId)];
      case 'not':
        return [...this.typeMatchWords(match.inner), this.make.text('でないもの')];
    }
  }

  /** 比較の相手。別のプロパティを見ているならその参照、リテラルなら値そのもの。 */
  private valueWords(reading: PropertyConditionReading): readonly T[] {
    const { valueRef } = reading;
    if (valueRef !== undefined)
      return [
        ...this.subject(valueRef.root, 'の'),
        this.make.property(valueRef.propertyGlobalId, valueRef.root),
      ];

    const words: T[] = [];
    for (const value of reading.values ?? []) {
      if (words.length > 0) words.push(this.make.text('・'));
      words.push(this.make.propertyValue(reading.propertyGlobalId, value));
    }
    return words;
  }
}

/**
 * 識別子をそのまま語にする作り手。
 *
 * シンボル型（6.6節）と宣言しているプロパティの値だけシンボル名へ戻す。シンボル型でも数値リテラルが
 * 書かれている箇所（未登録のIDになる）は数値のまま出す。
 */
function plainWordMaker(codex: WorldCodex): ConditionWordMaker<string> {
  return {
    text: (value) => value,
    property: (globalId) => codex.propertyNames.getName(globalId),
    propertyValue: (propertyGlobalId, value) => {
      if (!codex.symbolicProperties.has(propertyGlobalId)) return String(value);
      return codex.symbolNames.tryGetName(value) ?? String(value);
    },
    slot: (globalId) => codex.slotNames.getName(globalId),
    tag: (globalId) => codex.tagNames.getName(globalId),
    object: (globalId) => codex.objectNames.getName(globalId),
    stage: (name) => name,
  };
}
