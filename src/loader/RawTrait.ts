import type { YAMLMap, YAMLSeq } from 'yaml';

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

  /** represented_by（7.6節）で指定されたスロット名。未指定ならundefined。 */
  representedBy: string | undefined;

  actions: YAMLMap | undefined;
  combinations: YAMLMap | undefined;

  constructor(name: string, source: string) {
    this.name = name;
    this.source = source;
  }
}
