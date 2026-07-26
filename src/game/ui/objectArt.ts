/**
 * object_defごとの絵（カード全面に重ねる画像）の解決。
 *
 * 置き場所と名前の規約は `src/assets/objects/<object_defの識別子>.png` のみで、コード側への登録は
 * 要らない。識別子はCodex全体で一意（objectNamesは単一のレジストリ）なので、種別のプレフィックスも
 * サフィックスも付けない——アイテムから設置物へ移しても、ファイル名を変えずに済むようにするため。
 *
 * 一覧はimport.meta.globがビルド時に作る。実行時に総当たりで読みに行くと、絵をまだ用意していない
 * object_defのぶんだけ404が出るため。
 */
const FILES = import.meta.glob('../../assets/objects/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** object_defの識別子 → 画像のURL。 */
export const OBJECT_ART: ReadonlyMap<string, string> = new Map(
  Object.entries(FILES).map(([path, url]) => [path.replace(/^.*\/(.+)\.png$/, '$1'), url]),
);

/** object_defの識別子に対応するテクスチャキー（他のテクスチャと名前が衝突しないよう前置きする）。 */
export function objectTexture(objectName: string): string {
  return `object:${objectName}`;
}
