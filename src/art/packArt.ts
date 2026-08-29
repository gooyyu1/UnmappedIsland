import { nameWithoutPack } from '../asset-pack/packNames';

/**
 * アセットパックの絵を、同梱ぶんの在庫表へ重ねる（AssetPack.md 4節）。
 *
 * **在庫表は上書きしない。** 同じ鍵が既に在ればエラーにする——後から重ねた側が勝つと、どの絵が出るかが
 * 重ねる順という見えない要因で決まる（同6節）。
 *
 * ここで衝突しうるのは背景の絵だけ。型の絵の鍵には出所のパックが付く（objectArt）ので、同じ名前を
 * 2つのパックが持っても別の鍵になり、どちらが出るかは定義の出所で決まる（同5節）。
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
