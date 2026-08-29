import { nameWithoutPack } from '../asset-pack/packNames';

/** 1つのパックが持ち込む絵。鍵は在庫表のもの（型の絵は出所つき、背景の絵は名前そのまま）。 */
export interface PackArt {
  /** 出所のパック。名前が重なったとき、どのパックを外せばよいかを言うために持つ。 */
  readonly packName: string;
  readonly art: ReadonlyMap<string, string>;
}

/**
 * 在庫表を「同梱ぶん＋載せるパック」へ組み直す（AssetPack.md 4節）。
 *
 * **在庫表は上書きしない。** 同じ鍵が既に在ればエラーにする——後から重ねた側が勝つと、どの絵が出るかが
 * 重ねる順という見えない要因で決まる（同6節）。エラーになったパックは定義もろとも外れる（同6.1節。
 * 外すかどうかを決めるのは loadDefinitions で、ここへは載せると決まったパックだけが渡る）。
 *
 * **足すのではなく、同梱ぶんから組み直す。** 載せる並びが決まるまでには載せられない組み合わせも試す
 * ので（loadDefinitionsのacceptable）、足すだけだと外したパックの絵が残る。組み直しに失敗したときは
 * 在庫表を触らない——半端に入れ替わった表を誰も期待していない。
 *
 * ここで衝突しうるのは背景の絵だけ。型の絵の鍵には出所のパックが付く（objectArt）ので、同じ名前を
 * 2つのパックが持っても別の鍵になり、どちらが出るかは定義の出所で決まる（同5節）。
 */
export function rebuildArtCatalog(
  catalog: Map<string, string>,
  bundled: ReadonlyMap<string, string>,
  packs: readonly PackArt[],
  kind: string,
): void {
  const rebuilt = new Map(bundled);
  for (const { packName, art } of packs)
    for (const [name, url] of art) {
      if (rebuilt.has(name))
        throw new Error(
          `アセットパック '${packName}': ${kind} '${name}' は既にあります。差し替えるには専用の文法が要ります。`,
        );
      rebuilt.set(name, url);
    }

  catalog.clear();
  for (const [name, url] of rebuilt) catalog.set(name, url);
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
