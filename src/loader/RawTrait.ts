import type { YAMLMap, YAMLSeq } from 'yaml';
import type { YamlNode } from './yamlMapping';
import { asScalarText, tryGetBool, tryGetMap, tryGetScalar, tryGetSeq } from './yamlMapping';
import { namesIn } from './RawObjectDef';
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

  readonly tags: string[] = [];
  props: YAMLMap | undefined;
  slots: YAMLMap | undefined;
  passives: YAMLSeq | undefined;
  stackOrder: YAMLMap | undefined;

  /** visible_slots（7.11節）で並べられたスロット名。未指定なら空。 */
  visibleSlots: readonly string[] = [];

  /** storage（7.12節）。物を溜める入れ物として使う型か。tagsと同じくORで合成する。 */
  isStorage = false;

  /** art_by_stage（6.4節）で指定されたプロパティ名。未指定ならundefined。 */
  artByStage: string | undefined;

  /** bound_to_owner（7.9節）。単独では存在できない型か。 */
  boundToOwner = false;
  notStackable = false;

  actions: YAMLMap | undefined;
  combinations: YAMLMap | undefined;

  constructor(name: string, source: string, node: YAMLMap) {
    this.name = name;
    this.source = source;
    this.readFields(node);
  }

  /**
   * 宣言から各フィールドを取る。**object_defと同じ11のキーを読む**ので、読む側を2箇所に置かない
   * （RawObjectDef.readFieldsと対）。trait合成がまだ起こりうるものは生YAMLノードのまま持つ。
   */
  private readFields(node: YAMLMap): void {
    const context = `traits.'${this.name}'`;

    this.props = tryGetMap(node, 'props', context);
    this.slots = tryGetMap(node, 'slots', context);
    this.passives = tryGetSeq(node, 'passives', context);
    this.stackOrder = tryGetMap(node, 'stack_order', context);
    this.visibleSlots = namesIn(tryGetSeq(node, 'visible_slots', context), `${context}.visible_slots`);
    this.isStorage = tryGetBool(node, 'storage', context, false);
    this.artByStage = tryGetScalar(node, 'art_by_stage', context);
    this.boundToOwner = tryGetBool(node, 'bound_to_owner', context, false);
    this.notStackable = !tryGetBool(node, 'stackable', context, true);
    this.actions = tryGetMap(node, 'actions', context);
    this.combinations = tryGetMap(node, 'combinations', context);

    // レシピは成果物のobject_defへ埋め込むもの（RecipeSystem.md）なので、複数の型へ混ぜるtraitには
    // 書けない（どれが成果物か決まらない）。読み飛ばすと黙って消えるため、ロード時に弾く。
    if (tryGetMap(node, 'recipes', context) !== undefined)
      throw new YamlLoadError(
        `${context}: recipesはtraitに書けません（成果物のobject_defへ書いてください）。`,
      );

    const tags = tryGetSeq(node, 'tags', context);
    if (tags !== undefined)
      for (const t of tags.items as YamlNode[]) this.tags.push(asScalarText(t, context));
  }
}
