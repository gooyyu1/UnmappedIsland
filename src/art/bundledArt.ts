/**
 * 同梱されている絵の一覧。**ビルド時にimport.meta.globが作る**——実行時に総当たりで読みに行くと、
 * 絵をまだ用意していないぶんだけ404が出るため。
 *
 * **置き場が分かれていても、受け取り方は1つ。** どの在庫表も「その置き場のpngを集めて、ファイル名を
 * 鍵にする」で、置き場と鍵の前置きは引数で渡る——在庫表ごとに仕組みを持たない。
 */
const PNG_URL_BY_PATH = import.meta.glob('../assets/*/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const EXTENSION = '.png';

/**
 * `src/assets/<directory>/` に同梱されている絵の「鍵 → 画像のURL」。鍵はファイル名から拡張子を
 * 落としたもので、keyPrefixを渡すとその前に付く（テクスチャキーを鍵にしない在庫表は前置き無し、
 * objectArt参照）。
 *
 * **1枚も無ければ投げる。** 置き場の名前を書き間違えても、空の在庫表は「絵をまだ用意していない」
 * と見分けが付かず、その置き場の絵が黙って全部出なくなる。
 */
export function bundledArt(directory: string, keyPrefix = ''): ReadonlyMap<string, string> {
  const prefix = `../assets/${directory}/`;
  const found = Object.entries(PNG_URL_BY_PATH)
    .filter(([path]) => path.startsWith(prefix))
    .map(([path, url]): [string, string] => [keyPrefix + path.slice(prefix.length, -EXTENSION.length), url]);

  if (found.length === 0) throw new Error(`同梱の絵が1枚もありません: src/assets/${directory}/`);
  return new Map(found);
}
