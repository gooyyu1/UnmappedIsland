import type { ObjectDef } from '../domain/ObjectDef';
import type { WorldCodex } from '../domain/WorldCodex';
import type { Localization } from './Localization';

/**
 * その型の表示名。
 *
 * **ロード時に生成された型（GameElementDefinition.md 3.5節）は対応表に自分のエントリを持てない**ので、
 * 素の型の名前と軸の値の名前から組み立てる——作りかけなら「作りかけの斧」、中身入りなら
 * 「水入りの水筒」。書式は locale の default エントリが持つ（Localization.md）。
 *
 * 個体に付いた名前（土地の命名）は型の話ではないので、ここでは扱わない。
 */
export function typeDisplayName(codex: WorldCodex, locale: Localization, def: ObjectDef): string {
  const product = codex.productOf(def);
  if (product !== undefined)
    return locale.object(def.name).displayNameInProgress(locale.object(product.name).displayName);

  const texts = locale.object(codex.baseOf(def).name);
  const content = codex.contentsOf(def).at(0);
  return content === undefined
    ? texts.displayName
    : texts.displayNameWithContent(locale.object(content.name).displayName);
}
