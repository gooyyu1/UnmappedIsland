import { ModifyEffect, PassiveEffectGate } from './PassiveEffect';
import type { PassiveEffect } from './PassiveEffect';
import { ProductAmount } from './PassiveAmount';
import type { PropertyDef } from './PropertyDef';
import { PropertyPath } from './ReferenceRoot';
import type { EngineVocabulary } from './WorldVocabulary';

/**
 * 中身の重さの伝播（[`ContainerSystem.md`](../../docs/engine/ContainerSystem.md) 1〜2節）を、
 * **エンジンが型に生やす持続効果**として組み立てる。
 *
 * - `weight` → 親の `weight`: 自分の重さは、自分を抱えている物を重くする。
 * - `weight` × `load_rate` → 親の `load`: 担いだ人が感じる負荷は、体感の割合を掛けた分だけ。
 * - `fill` × `density` → 自分の `weight`: 抱えている量そのものの重さ（mL × g/mL = g）。
 *
 * **書いているのは与える側**で、寄与の登録・解除・実効値への合算・影響の一覧は、YAMLの`modify`
 * （8.3節）とまったく同じ経路をそのまま通る。エンジンがこれを代筆するのは、**この宣言に自由度が
 * 1つも無い**ため——重さを持つ物が、それを担いでいる物を重くしない世界は無い。書き忘れも書き換えも
 * 起こらないものは、宣言ではなく法則なので、著者に書かせない。
 *
 * 因子に並べるのは**その型が実際に宣言しているプロパティだけ**なので、「宣言されていない因子は1」
 * という規約は要らない（ProductAmount参照）。`load_rate`を持たない物は素の重さぶん効き、
 * `density`を持たない量は1 g/mLとして扱われる。
 */
export function containerPropagationPassives(
  defName: string,
  propertyDefs: readonly PropertyDef[],
  engine: EngineVocabulary,
): readonly PassiveEffect[] {
  const declares = (globalId: number): boolean => propertyDefs.some((def) => def.globalId === globalId);

  // **量を抱える物は、重さを名乗っていなければならない。** 抱えている量の重さ（fill × density）を
  // 載せる先が無いと、その重さはどこにも現れないまま消える。
  if (declares(engine.fillId) && !declares(engine.weightId))
    throw new Error(
      `'${defName}'は'fill'を宣言していますが'weight'がありません` +
        '（抱えている量の重さ（fill × density）を載せる先が要ります）。',
    );

  const always = new PassiveEffectGate(undefined);
  const passives: PassiveEffect[] = [];

  if (declares(engine.weightId)) {
    passives.push(
      new ModifyEffect(
        new PropertyPath('parent', engine.weightId),
        new ProductAmount([engine.weightId]),
        always,
      ),
      new ModifyEffect(
        new PropertyPath('parent', engine.loadId),
        new ProductAmount(
          declares(engine.loadRateId) ? [engine.weightId, engine.loadRateId] : [engine.weightId],
        ),
        always,
      ),
    );
  }

  if (declares(engine.fillId)) {
    passives.push(
      new ModifyEffect(
        new PropertyPath('self', engine.weightId),
        new ProductAmount(declares(engine.densityId) ? [engine.fillId, engine.densityId] : [engine.fillId]),
        always,
      ),
    );
  }

  return passives;
}
