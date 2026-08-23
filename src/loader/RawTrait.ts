import type { YAMLMap } from 'yaml';
import { tryGetMap } from './yamlMapping';
import { RawDeclarationBody } from './RawDeclarationBody';
import { YamlLoadError } from './YamlLoadError';

/**
 * traits（GameElementDefinition.md 5節、mixin）の1エントリの生の形。上書きマージ
 * （RawObjectDef.resolve参照）がまだ起こりうるフィールドは生YAMLノードのまま持つ。
 * 1つのtraitは複数のobject_defから参照され、参照ごとに異なるマージが起こるため、
 * 「一度きり確定する完成品」にはできない（1回だけ解決されるRawObjectDefとの本質的な違い）。
 */
export class RawTrait {
  readonly name: string;

  /** 読み込み元。重複エラーメッセージの出所表示にのみ使う。 */
  readonly source: string;

  /** 混ぜ込まれる宣言一式。traitはこれだけのもので、素性（globalId・recipes等）を持たない。 */
  readonly body = new RawDeclarationBody();

  constructor(name: string, source: string, node: YAMLMap) {
    this.name = name;
    this.source = source;

    const context = `traits.'${name}'`;
    this.body.readFields(node, context);

    // レシピは成果物のobject_defへ埋め込むもの（RecipeSystem.md）なので、複数の型へ混ぜるtraitには
    // 書けない（どれが成果物か決まらない）。読み飛ばすと黙って消えるため、ロード時に弾く。
    if (tryGetMap(node, 'recipes', context) !== undefined)
      throw new YamlLoadError(
        `${context}: recipesはtraitに書けません（成果物のobject_defへ書いてください）。`,
      );
  }
}
