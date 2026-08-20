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

  constructor(name: string, source: string) {
    this.name = name;
    this.source = source;
  }
}
