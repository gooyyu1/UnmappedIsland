import type { EffectDeclaration } from '../../domain/EffectReader';
import type { InteractionDef } from '../../domain/InteractionDef';
import type { ObjectDef } from '../../domain/ObjectDef';
import type { PropertyDef } from '../../domain/PropertyDef';
import type { DefNames, DescriptionToken, DescriptionWriter } from './Description';
import { actionRef, combinationRef, propertyRef, text } from './Description';
import { describeInteraction } from './describeInteraction';
import { describeRangeEvent } from './describeProperty';
import { stackOrderTokens } from './stackOrderTokens';
import { describePassive, passiveWritesToProperty } from './describePassive';
import { spawnsObject, writesToProperty } from './effectQueries';

/**
 * 型そのものの性質（4節・7節の宣言）を書き出す。既定と同じ性質は書かない——「特に断っていない」ことと
 * 同じ意味なので、並べても読み手の手掛かりにならないため。
 */
export function describeObjectDef(def: ObjectDef, names: DefNames, out: DescriptionWriter): void {
  if (def.isSingleton) out.write(text('singleton: 世界にただ1つだけ存在する'));
  if (!def.stackable) out.write(text('stackable: false（同種でも1個ずつ別の枠に並ぶ）'));
  if (def.boundToOwner) out.write(text('bound_to_owner: 入っていた親が消えるとき一緒に消える'));

  if (def.stackOrder !== undefined)
    out.write(text('stack_order: '), ...stackOrderTokens(def.stackOrder.reading, names));

  if (def.artByStagePropertyGlobalId !== undefined)
    out.write(
      text('art_by_stage: '),
      propertyRef(names.propertyName(def.artByStagePropertyGlobalId)),
      text('の段が絵を切り替える'),
    );
}

/**
 * この型が、propertyGlobalIdのプロパティを書き換えうる箇所をすべて書き出す（プロパティ側からの逆引き）。
 *
 * ownedByThisDefは、そのプロパティがこの型自身のものか。falseなら、他の型のプロパティを書き換えうる
 * 宣言だけを書く（target=selfは常に宣言元自身のプロパティを指すため、他の型の同名プロパティには
 * 届かない）。
 */
export function describeInfluencesOn(
  def: ObjectDef,
  propertyGlobalId: number,
  ownedByThisDef: boolean,
  names: DefNames,
  out: DescriptionWriter,
): void {
  for (const effect of def.passives.declarations)
    if (passiveWritesToProperty(effect, propertyGlobalId, ownedByThisDef))
      describePassive(effect, names, out);

  const matches = (declaration: EffectDeclaration): boolean =>
    writesToProperty(declaration, propertyGlobalId, ownedByThisDef);

  for (const propertyDef of def.enumeratePropertyDefs()) {
    // 自分自身を値域へ丸めるon_max/on_minは、そのプロパティの定義を見れば分かる
    // （「どこから影響されるか」を知りたい読み手には何も足さない）。
    if (ownedByThisDef && propertyDef.globalId === propertyGlobalId) continue;
    describeMatchingRangeEvents(propertyDef, matches, names, out);
  }

  for (const [token, interaction] of matchingInteractions(def, matches)) {
    out.write(token, text(':'));
    out.indented(() => describeInteraction(interaction, names, out));
  }
}

/**
 * この型が、objectGlobalIdの型を生み出しうるか（生まれる側からの逆引き）。生むのはspawn（9.4節）だけ
 * なので、探すのはactions・combinationsとrange系イベント。
 *
 * どの操作で生まれるかまでは返さない——「これはどこから手に入るのか」を知りたい読み手には、生む側の型が
 * 答えで、その先はその型のページにある。
 */
export function creates(def: ObjectDef, objectGlobalId: number): boolean {
  const matches = (declaration: EffectDeclaration): boolean => spawnsObject(declaration, objectGlobalId);
  return (
    def.enumeratePropertyDefs().some((propertyDef) => propertyDef.hasRangeEventMatching(matches)) ||
    matchingInteractions(def, matches).length > 0
  );
}

/**
 * この型のレシピが、candidateDefを素材か道具として要求しているか（材料側からの逆引き）。
 * 「何になるのか」を知りたい読み手には完成品＝この型が答えなので、どの工程で使うかまでは返さない。
 */
export function usesInRecipes(def: ObjectDef, candidateDef: ObjectDef): boolean {
  return def.recipes.some((recipe) => recipe.requires(candidateDef));
}

/** 1つのプロパティのrange系イベントのうち、matchesが真になるものを、宣言元の名前を添えて書き出す。 */
function describeMatchingRangeEvents(
  propertyDef: PropertyDef,
  matches: (declaration: EffectDeclaration) => boolean,
  names: DefNames,
  out: DescriptionWriter,
): void {
  if (!propertyDef.hasRangeEventMatching(matches)) return;
  out.write(propertyRef(propertyDef.name), text(':'));
  out.indented(() => {
    for (const [label, effect] of propertyDef.rangeEvents())
      if (matches(effect)) describeRangeEvent(label, effect, names, out);
  });
}

/** matchesが真になる操作を、その名前を指す断片（actions/combinationsの区別つき）とともに集める。 */
function matchingInteractions(
  def: ObjectDef,
  matches: (declaration: EffectDeclaration) => boolean,
): readonly (readonly [DescriptionToken, InteractionDef])[] {
  const found: (readonly [DescriptionToken, InteractionDef])[] = [];
  for (const action of def.actions) if (matches(action)) found.push([actionRef(action.name), action]);
  for (const combination of def.combinations)
    if (matches(combination)) found.push([combinationRef(combination.name), combination]);
  return found;
}
