import type { YAMLMap } from 'yaml';
import { asMap, entriesInOrder, requireScalar, tryGetBool, tryGetMap, tryGetSeq } from './yamlMapping';
import { YamlLoadError } from './YamlLoadError';
import { withYamlContext } from './parseCommon';
import { parsePropAppendingPassives } from './parseProperties';
import { parseSlot } from './parseSlots';
import { parsePassiveInto } from './parsePassives';
import { parseInteractions } from './parseInteractions';
import { parseRecipes } from './parseRecipes';
import { parseConditionsField } from './parseConditions';
import type { WorldCodexYamlLoader } from './WorldCodexYamlLoader';
import type { RawTrait } from './RawTrait';
import { RawDeclarationBody, namesIn } from './RawDeclarationBody';
import { IN_PROGRESS_TAG } from '../domain/RecipeDef';
import { LocalIndexByGlobalId } from '../domain/LocalIndexByGlobalId';
import { ObjectDef } from '../domain/ObjectDef';
import { ReferenceScope } from '../domain/ReferenceRoot';
import { containerPropagationPassives } from '../domain/containerPropagation';
import type { PassiveEffect } from '../domain/PassiveEffect';
import type { PropertyDef } from '../domain/PropertyDef';
import type { SlotDef } from '../domain/SlotDef';
import { StackOrderDef } from '../domain/StackOrderDef';
import { WornCoverage } from '../domain/WornCoverage';

/** object_defが宣言一式に足して読むキー（型自身の素性。RawDeclarationBody.readFields参照）。 */
const OBJECT_DEF_OWN_KEYS = ['traits', 'singleton', 'recipes', 'variation_axes'];

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

    this.body.readFields(this.node, context, OBJECT_DEF_OWN_KEYS);
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
   * - props/slots/interactions: 同名エントリが複数のtraitにあればエラー（5節）。
   *   object_def自身が同名エントリを持つ場合はフィールド単位で上書き（残りはtrait側を引き継ぐ）。
   * - passives/covers: 識別子を持たないため単純に連結（trait由来→自分自身の順）。
   * - stack_order/art_by_stage/resists/layer: 自分自身の指定を優先。無ければちょうど1つの
   *   traitが指定している必要がある（複数ならエラー）。
   * - recipes: 成果物ごとの内容なので合成せず、自分自身の宣言だけを読む。
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
          parsePropAppendingPassives(
            loader,
            this.name,
            propName,
            asMap(propValueNode, `'${this.name}'.props.'${propName}'`),
            passives,
          ),
        );
    requireNoSelfBaseCycle(this.name, propertyDefs);
    const propertyIndexByGlobalId = new LocalIndexByGlobalId(
      loader.propertyNames.count,
      propertyDefs.map((p) => p.globalId),
    );

    const slotDefs: SlotDef[] = [];
    if (merged.slots !== undefined)
      for (const [slotName, slotValueNode] of entriesInOrder(merged.slots))
        slotDefs.push(
          parseSlot(loader, this.name, slotName, asMap(slotValueNode, `'${this.name}'.slots.'${slotName}'`)),
        );
    const slotIndexByGlobalId = new LocalIndexByGlobalId(
      loader.slotNames.count,
      slotDefs.map((s) => s.globalId),
    );

    for (const passiveNode of merged.passives)
      parsePassiveInto(loader, passives, this.name, passiveNode, undefined, undefined);

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

    const interactions = parseInteractions(loader, this.name, merged.interactions);

    // resists（7.13節）が見るのは宣言元の個体だけ——移そうとしている者が居るとは限らない場面
    // （tick・こぼれ落ち）でも同じ判定が走る。
    const resists = parseConditionsField(
      loader,
      `'${this.name}'.resists`,
      merged.resists,
      ReferenceScope.declaration,
    );

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

    return withYamlContext(
      `'${this.name}'`,
      () =>
        new ObjectDef(
          this.globalId,
          this.name,
          this.isSingleton,
          propertyIndexByGlobalId,
          propertyDefs,
          slotIndexByGlobalId,
          slotDefs,
          passives,
          stackOrder,
          tagIds,
          interactions,
          merged.boundToOwner,
          !merged.notStackable,
          parseRecipes(loader, this.name, this.recipes),
          artByStagePropertyGlobalId,
          visibleSlotGlobalIds,
          merged.isStorage,
          tagIds.includes(loader.tagNames.intern(IN_PROGRESS_TAG)),
          resists,
          wornCoverageOf(loader, this.name, merged),
        ),
    );
  }
}

/**
 * `covers` / `layer`（7.5節）から、身につけたときに占める場所を組み立てる。どちらも無ければundefined。
 *
 * **2つは対でしか書けない。** 片方だけでは競合を判定できない（部位の無い階層は誰とも重ならず、
 * 階層の無い部位はどの段で重なるかを言えない）ので、書き漏らしはロード時に弾く。
 */
function wornCoverageOf(
  loader: WorldCodexYamlLoader,
  objectDefName: string,
  merged: RawDeclarationBody,
): WornCoverage | undefined {
  const { covers, layer } = merged;
  if (covers.length === 0 && layer === undefined) return undefined;
  if (covers.length === 0 || layer === undefined)
    throw new YamlLoadError(
      `'${objectDefName}': covers と layer は対で宣言してください（7.5節。` +
        `${layer === undefined ? 'layer' : 'covers'} がありません）。`,
    );

  return new WornCoverage(
    [...new Set(covers.map((part) => loader.tagNames.intern(part)))],
    loader.tagNames.intern(layer),
  );
}

/**
 * `base`（6.5節）が自分自身へ戻る循環を弾く。**辿るのは`subject: self`の辺だけ**——`parent`と
 * `ancestor`は木を必ず上るので、1つの型の宣言だけからは循環になりえない。逆に`self`の循環は
 * 同じ型の中で閉じるので、実行時を待たずにここで言える。
 */
function requireNoSelfBaseCycle(objectDefName: string, propertyDefs: readonly PropertyDef[]): void {
  const byGlobalId = new Map(propertyDefs.map((propertyDef) => [propertyDef.globalId, propertyDef]));

  for (const start of propertyDefs) {
    const visited = new Set<number>([start.globalId]);
    let current: PropertyDef = start;
    while (current.base !== undefined && current.base.root === 'self') {
      const next: PropertyDef | undefined = byGlobalId.get(current.base.propertyGlobalId);
      if (next === undefined) break;
      if (visited.has(next.globalId))
        throw new YamlLoadError(
          `'${objectDefName}'.props.'${start.name}': baseが辿った先から自分へ戻ってきます（6.5節）。`,
        );
      visited.add(next.globalId);
      current = next;
    }
  }
}
