import type { ObjectDef } from '../domain/ObjectDef';
import type { WorldCodex } from '../domain/WorldCodex';
import type { Localization } from './Localization';

/**
 * その型の表示名。
 *
 * **ロード時に生成された型（GameElementDefinition.md 3.5節）は対応表に自分のエントリを持てない**ので、
 * 素の型の名前から始めて、動いた軸のぶんだけ書式（対応表のvariation_names）を重ねる——中身入りなら
 * 「水入りの甕」。**軸がいくつ動いても同じ1つの畳み込み**で、軸ごとの分岐は無い（書式の側が軸ごとに
 * 違うだけ）。**素の型の名前をそのまま返す書式もある**——同梱のロケールは作りかけ（recipe軸）を
 * これにしていて、作りかけであることは名前ではなく青い覆いが言う（CardView.md 10節）。
 *
 * 個体に付いた名前（土地の命名）は型の話ではないので、ここでは扱わない。
 */
export function typeDisplayName(codex: WorldCodex, locale: Localization, def: ObjectDef): string {
  const texts = locale.object(codex.baseOf(def).name);

  let name = texts.displayName;
  for (const [axis, value] of codex.variationsOf(def))
    name = texts.variationName(axis, name, locale.object(value).displayName);
  return name;
}
