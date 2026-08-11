import type { ReferenceRoot } from './ReferenceRoot';

/**
 * 定義（conditions・passives・active効果など）が自分自身を書き表した説明の断片。
 *
 * 識別子への参照を地の文と分けて持つのは、**表示側が識別子をどう見せるかを選べるようにする**ため。
 * 表示名（[`Localization`](../../locale/Localization.ts)）へ差し替える、リンクを張る、識別子のまま
 * 出す——どれを採るかは読み手（ゲーム画面かデータベースビューアか）によって違う。
 */
export type DescriptionToken =
  /** 地の文（識別子ではない部分）。 */
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'object'; readonly name: string }
  /** プロパティ参照。rootは`self`などの起点で、起点を持たない文脈（プロパティ自身の宣言）ではundefined。 */
  | { readonly kind: 'property'; readonly name: string; readonly root: ReferenceRoot | undefined }
  | { readonly kind: 'slot'; readonly name: string }
  | { readonly kind: 'tag'; readonly name: string }
  /** シンボル型プロパティ（GameElementDefinition.md 6.6節）の値。 */
  | { readonly kind: 'symbol'; readonly name: string }
  /** プロパティのタグ（6.7節）。 */
  | { readonly kind: 'property_tag'; readonly name: string }
  /** 段（6.4節）の名前。段は宣言したプロパティごとの名前で、独立した名前空間を持たない。 */
  | { readonly kind: 'stage'; readonly name: string }
  /** 要件が満たされない理由（14.6節）の識別子。 */
  | { readonly kind: 'reason'; readonly name: string };

export function text(value: string): DescriptionToken {
  return { kind: 'text', text: value };
}

export function objectRef(name: string): DescriptionToken {
  return { kind: 'object', name };
}

export function propertyRef(name: string, root?: ReferenceRoot): DescriptionToken {
  return { kind: 'property', name, root };
}

export function slotRef(name: string): DescriptionToken {
  return { kind: 'slot', name };
}

export function tagRef(name: string): DescriptionToken {
  return { kind: 'tag', name };
}

export function symbolRef(name: string): DescriptionToken {
  return { kind: 'symbol', name };
}

export function propertyTagRef(name: string): DescriptionToken {
  return { kind: 'property_tag', name };
}

export function stageRef(name: string): DescriptionToken {
  return { kind: 'stage', name };
}

export function reasonRef(name: string): DescriptionToken {
  return { kind: 'reason', name };
}

/** 増減量の書き表し方。正の値にも符号を付けて、絶対値ではなく増減であることを見て取れるようにする。 */
export function signedNumber(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}

/** 説明の1行。depthは入れ子の深さ（pickの候補・レシピの工程など、行の親子関係を示す）。 */
export class DescriptionLine {
  readonly depth: number;
  readonly tokens: readonly DescriptionToken[];

  constructor(depth: number, tokens: readonly DescriptionToken[]) {
    this.depth = depth;
    this.tokens = tokens;
  }

  /** 参照を識別子のまま連結した平文。表示名を要さない読み手（テスト・ログ）向け。 */
  toPlainText(): string {
    return this.tokens.map((token) => (token.kind === 'text' ? token.text : token.name)).join('');
  }
}

/**
 * 説明の書き込み先。`describe`を持つ定義は、自分の内容をここへ行単位で書き出す。
 *
 * 行の組み立て（どの語をどう並べるか）は定義自身が、行の見せ方（HTML・リンク・表示名）は
 * 受け取った側が担う。
 */
export class DescriptionWriter {
  private readonly lines: DescriptionLine[] = [];
  private depth = 0;

  /** 1行書く。 */
  write(...tokens: DescriptionToken[]): void {
    this.lines.push(new DescriptionLine(this.depth, tokens));
  }

  /** bodyが書く行を1段深い位置に置く（pickの候補、レシピの工程が要求する素材など）。 */
  indented(body: () => void): void {
    this.depth++;
    try {
      body();
    } finally {
      this.depth--;
    }
  }

  /** 1行も書かれていないか（「(なし)」を出すかの判断に使う）。 */
  get isEmpty(): boolean {
    return this.lines.length === 0;
  }

  toLines(): readonly DescriptionLine[] {
    return this.lines;
  }

  /** 全行を改行区切りの平文にする（深さは2スペースの字下げで表す）。 */
  toPlainText(): string {
    return this.lines.map((line) => '  '.repeat(line.depth) + line.toPlainText()).join('\n');
  }
}

/**
 * グローバルIDを識別子へ戻す窓口（`describe`が使う）。実装は[`WorldCodex`](./WorldCodex.ts)。
 *
 * 定義はグローバルIDだけを持ち、名前空間そのものは持たないため、自分を書き表すには
 * 「IDから名前へ戻す係」を渡してもらう必要がある。
 */
export interface DefNames {
  objectName(globalId: number): string;
  propertyName(globalId: number): string;
  slotName(globalId: number): string;
  tagName(globalId: number): string;
  propertyTagName(globalId: number): string;

  /**
   * プロパティの値1つの書き表し方。シンボル型プロパティ（6.6節）の値はシンボル名へ戻し、
   * それ以外は数値のまま書く（型に関わらず実行時の値はどちらも数値なので、プロパティ側に尋ねる）。
   */
  propertyValue(propertyGlobalId: number, value: number): DescriptionToken;
}
