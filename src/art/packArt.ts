import { nameWithoutPack } from '../asset-pack/packNames';

/**
 * アセットパックの絵を、同梱ぶんの在庫表へ重ねる（AssetPack.md 4節）。
 *
 * **同じ名前の絵が既に在ればエラーにする。** 定義YAMLと同じ規則（同6節）で、後勝ちの上書きは
 * 持たない。黙って勝たせると、パックを入れた人の画面だけが読み込み順という見えない要因で変わる。
 */
export function addPackArt(
  catalog: Map<string, string>,
  art: ReadonlyMap<string, string>,
  packName: string,
  kind: string,
): void {
  for (const [name, url] of art) {
    if (catalog.has(name))
      throw new Error(
        `アセットパック '${packName}': ${kind} '${name}' は既にあります。差し替えるには専用の文法が要ります。`,
      );
    catalog.set(name, url);
  }
}

/**
 * 在庫表でその絵が並んでいる鍵（用意されていなければundefined）。
 *
 * **パックの型の絵は、まずそのパックのぶんを見て、無ければ同梱ぶんへ落ちる**（AssetPack.md 5節）。
 * どちらを見るかは、名前に添えられた出所のパック（packNames）だけで決まるので、読み込み順では
 * 変わらない。落とし先があることで「定義だけを足して絵は同梱のものを使う」パックが書ける。
 */
export function artKeyIn(catalog: ReadonlyMap<string, string>, artName: string): string | undefined {
  if (catalog.has(artName)) return artName;
  const bundled = nameWithoutPack(artName);
  return catalog.has(bundled) ? bundled : undefined;
}
