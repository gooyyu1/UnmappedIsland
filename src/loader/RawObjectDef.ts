import type { YAMLMap } from 'yaml';
import { asMap, entriesInOrder, requireScalar, tryGetBool, tryGetMap, tryGetSeq } from './yamlMapping';
import { YamlLoadError } from './YamlLoadError';
import { built } from './parseCommon';
import { parseProp } from './parseProperties';
import { parseSlot } from './parseSlots';
import { parsePassive } from './parsePassives';
import { parseActions, parseCombinations } from './parseActionsAndCombinations';
import { parseRecipes } from './parseRecipes';
import type { WorldCodexYamlLoader } from './WorldCodexYamlLoader';
import type { RawTrait } from './RawTrait';
import { RawDeclarationBody, namesIn } from './RawDeclarationBody';
import { IN_PROGRESS_TAG } from '../domain/RecipeDef';
import { LocalIndexMap } from '../domain/LocalIndexMap';
import { ObjectDef } from '../domain/ObjectDef';
import { containerPropagationPassives } from '../domain/containerPropagation';
import type { PassiveEffect } from '../domain/PassiveEffect';
import type { PropertyDef } from '../domain/PropertyDef';
import type { SlotDef } from '../domain/SlotDef';
import { StackOrderDef } from '../domain/StackOrderDef';

/**
 * object_defs（GameElementDefinition.md 4節）の1エントリの、まだtrait解決を経ていない生の形。
 * trait上書きマージ（resolve参照）がまだ起こりうるフィールドは、意味解釈済みの型にせず
 * 生YAMLノードのまま持つ。globalIdのみパース時点で確定し、tags・prop/slot名等はresolveで
 * 初めて確定する。
 */
export class RawObjectDef {
  readonly name: string;

  /** 読み込み元。重複エラーメッセージの出所表示にのみ使う。 */
  readonly source: string;

  /** objectNames.internによるグローバルID。trait解決を待たずパース時点で確定する。 */
  readonly globalId: number;

  /**
   * 宣言そのもの。patch（3.4節）はこのノードを書き換え、書き換えたら readFields を呼び直して
   * 下の各フィールドを取り直す。フィールドはこのノードの一部を指しているだけなので、両者が
   * 食い違ったまま resolve へ進まないよう、取り直しはこのクラス自身が引き受ける。
   */
  readonly node: YAMLMap;

  /** 混ぜ込める宣言一式（traitと共有する部分）。 */
  readonly body = new RawDeclarationBody();

  isSingleton = false;
  traitNames: string[] = [];

  /** recipes（13節）。成果物ごとの内容なのでtrait合成の対象にしない（resolve参照）。 */
  recipes: YAMLMap | undefined;

  /**
   * variation_axes（3.5節）。この型の変種を並べる軸で、読むのは生成器（axisVariants.ts）だけ。
   * trait合成の対象にしない——どんな変種を持つかは、混ぜ込まれる側ではなく型自身の性質。
   */
  variationAxes: YAMLMap | undefined;

  constructor(name: string, source: string, globalId: number, node: YAMLMap) {
    this.name = name;
    this.source = source;
    this.globalId = globalId;
    this.node = node;
    this.readFields();
  }

  /** 宣言から各フィールドを取り直す。trait合成がまだ起こりうるものは生YAMLノードのまま持つ。 */
  readFields(): void {
    const context = `object_defs.'${this.name}'`;

    this.body.read(this.node, context);
    this.isSingleton = tryGetBool(this.node, 'singleton', context) ?? false;
    this.recipes = tryGetMap(this.node, 'recipes', context);
    this.variationAxes = tryGetMap(this.node, 'variation_axes', context);
    this.traitNames = namesIn(tryGetSeq(this.node, 'traits', context), context);
  }

  /**
   * 参照するtraitを合成し（フェーズ1: YAMLノードレベルのマージ）、そこから最終的なObjectDefを
   * 組み立てる（フェーズ2: loaderの各parse関数による意味解釈）。
   *
   * 合成規則（フェーズ1）:
   * - props/slots/actions/combinations: 同名エントリが複数のtraitにあればエラー（5節）。
   *   object_def自身が同名エントリを持つ場合はフィールド単位で上書き（残りはtrait側を引き継ぐ）。
   * - passives: 識別子を持たないため単純に連結（trait由来→自分自身の順）。
   * - stack_order/art_by_stage: 自分自身の指定を優先。無ければちょうど1つの
   *   traitが指定している必要がある（複数ならエラー）。
   * - recipes: 成果物ごとの内容なので合成せず、自分自身の宣言だけを読む。
   * 未対応（Codex側にビルド先の型が無いため意図的にスキップ）: covers/layer。
   */
  resolve(traitsByName: ReadonlyMap<string, RawTrait>, loader: WorldCodexYamlLoader): ObjectDef {
    const traits = this.traitNames.map((traitName) => {
      const trait = traitsByName.get(traitName);
      if (trait === undefined)
        throw new YamlLoadError(`'${this.name}' が参照するtrait '${traitName}' が見つかりません。`);
      return [traitName, trait.body] as const;
    });

    // フェーズ1: 宣言一式どうしを混ぜる（規則はRawDeclarationBody.merged）。
    const merged = this.body.merged(traits, this.name);

    // フェーズ2: マージ済みノードから最終的なObjectDefを組み立てる。
    const passives: PassiveEffect[] = [];

    const propertyDefs: PropertyDef[] = [];
    if (merged.props !== undefined)
      for (const [propName, propValueNode] of entriesInOrder(merged.props))
        propertyDefs.push(
          parseProp(
            loader,
            this.name,
            propName,
            asMap(propValueNode, `'${this.name}'.props.'${propName}'`),
            passives,
          ),
        );
    const propertyLayout = new LocalIndexMap(
      loader.propertyNames.count,
      propertyDefs.map((p) => p.globalId),
    );

    const slotDefs: SlotDef[] = [];
    if (merged.slots !== undefined)
      for (const [slotName, slotValueNode] of entriesInOrder(merged.slots))
        slotDefs.push(
          parseSlot(loader, this.name, slotName, asMap(slotValueNode, `'${this.name}'.slots.'${slotName}'`)),
        );
    const slotLayout = new LocalIndexMap(
      loader.slotNames.count,
      slotDefs.map((s) => s.globalId),
    );

    for (const passiveNode of merged.passives)
      parsePassive(loader, passives, this.name, passiveNode, undefined, undefined);

    // 中身の重さの伝播は著者に書かせず、エンジンが同じ`modify`の形で生やす（containerPropagation）。
    passives.push(...containerPropagationPassives(this.name, propertyDefs, loader.engine));

    let stackOrder: StackOrderDef | undefined;
    if (merged.stackOrder !== undefined) {
      const context = `'${this.name}'.stack_order`;
      stackOrder = new StackOrderDef(
        loader.propertyNames.intern(requireScalar(merged.stackOrder, 'property', context)),
        tryGetBool(merged.stackOrder, 'ascending', context) ?? false,
      );
    }

    const actions = parseActions(loader, this.name, merged.actions);
    const combinations = parseCombinations(loader, this.name, merged.combinations);

    // **操作の名前は1つの名前空間**（11節）。同じカードに同名の操作が2つ並ぶと、押して開く
    // メニューの「食べる」と重ねたときの「食べる」をプレイヤーが見分けられない。
    const tagIds = [...new Set(merged.tags.map((tag) => loader.tagNames.intern(tag)))];

    // visible_slots（7.11節）はタグと同じく足し合わせる。**並びが表示順**なので、trait由来を先に、
    // 自分自身の宣言を後ろに置く。同じスロットを2度書いても先に現れた位置を保つ。
    const visibleSlotGlobalIds = [...new Set(merged.visibleSlots)].map((slotName) => {
      const slotDef = slotDefs.find((candidate) => candidate.globalId === loader.slotNames.intern(slotName));
      if (slotDef === undefined)
        throw new YamlLoadError(`'${this.name}': visible_slots が指すスロット '${slotName}' を持ちません。`);
      return slotDef.globalId;
    });

    const artByStageName = merged.artByStage;
    const artByStagePropertyGlobalId =
      artByStageName !== undefined ? loader.propertyNames.intern(artByStageName) : undefined;

    if (artByStagePropertyGlobalId !== undefined) {
      const target = propertyDefs.find((propertyDef) => propertyDef.globalId === artByStagePropertyGlobalId);
      if (target === undefined)
        throw new YamlLoadError(
          `'${this.name}': art_by_stage が指すプロパティ '${artByStageName}' を持ちません。`,
        );
      if (!target.hasStages)
        throw new YamlLoadError(
          `'${this.name}': art_by_stage が指すプロパティ '${artByStageName}' はstagesを持ちません。`,
        );
    }
    // 段のartを宣言できるのはart_by_stageが指すプロパティだけ（1オブジェクト1絵の原則、6.4節）。
    // 他のプロパティの段が黙って無視されるのを避けるため、ロード時に弾く。
    for (const propertyDef of propertyDefs)
      if (propertyDef.hasStageArt && propertyDef.globalId !== artByStagePropertyGlobalId)
        throw new YamlLoadError(
          `'${this.name}': プロパティ '${propertyDef.name}' の段がartを宣言していますが、` +
            `art_by_stage は${artByStageName !== undefined ? `'${artByStageName}'` : '未指定'}です。` +
            `段にartを書けるのはart_by_stageが指すプロパティだけです。`,
        );

    return built(
      `'${this.name}'`,
      () =>
        new ObjectDef(
          this.globalId,
          this.name,
          this.isSingleton,
          propertyLayout,
          propertyDefs,
          slotLayout,
          slotDefs,
          passives,
          stackOrder,
          tagIds,
          actions,
          combinations,
          merged.boundToOwner,
          !merged.notStackable,
          parseRecipes(loader, this.name, this.recipes),
          artByStagePropertyGlobalId,
          visibleSlotGlobalIds,
          merged.isStorage,
          tagIds.includes(loader.tagNames.intern(IN_PROGRESS_TAG)),
        ),
    );
  }
}
