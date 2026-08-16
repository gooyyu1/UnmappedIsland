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
