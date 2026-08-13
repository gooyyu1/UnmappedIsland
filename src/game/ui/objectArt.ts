/**
 * object_defごとの絵の解決。
 *
 * 置き場所と名前の規約は `src/assets/objects/<object_defの識別子>.png` のみで、コード側への登録は
 * 要らない。識別子はCodex全体で一意（objectNamesは単一のレジストリ）なので、種別のプレフィックスも
 * サフィックスも付けない——アイテムから設置物へ移しても、ファイル名を変えずに済むようにするため。
 * 唯一の例外が、載り方が違う絵を表す接尾辞（MULTIPLY_SUFFIX）。
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

/**
 * 絵が描かれているときのカードの幅（tools/comfyui/card_art.py の CARD_WIDTH と同じ値）。
 *
 * 絵はこの幅のカードに載せる前提で作られていて、画像そのものの寸法は絵ごとに違う。小さい物は小さい
 * 画像で持ち、カードの中央へ置かれる。表示側は寸法を気にせず、常に cardWidth / この値 倍で描けばよい。
 */
export const CARD_ART_WIDTH = 410;

/** object_defの識別子に対応するテクスチャキー（他のテクスチャと名前が衝突しないよう前置きする）。 */
export function objectTexture(objectName: string): string {
  return `object:${objectName}`;
}

/**
 * 通常の絵の上へ**乗算で**重なる絵のファイル名の接尾辞。
 *
 * 痣のような「肌の変色」は、肌の上に在る物ではなく肌そのものの色が変わったものなので、通常の
 * 重ねだと絵の具に見える。乗算なら下地の陰影が残り、変色として読める。
 *
 * **接尾辞が合成方法そのものを名乗る。** 「怪我の絵は乗算」のように種別へ結び付けると、絵の
 * ファイルだけを見てどう載るのかが分からない。名前が「白は描くな・照りは描くな」という描き手への
 * 制約をそのまま伝える。
 *
 * **「変わらない」は透明で表す（白ではない）。** Canvasレンダラでは乗算が通常の重ねに落ちるため、
 * 白を「変わらない」の意味で使うと白い塊がそのまま出る（DesignNotes.md PhaserのWebGL専用機能節）。
 */
const MULTIPLY_SUFFIX = '_multiply';

/** 通常の絵に重ねる、乗算の絵のテクスチャキー（用意されていなければundefined）。 */
export function objectMultiplyTexture(objectName: string): string | undefined {
  const fileName = `${objectName}${MULTIPLY_SUFFIX}`;
  return OBJECT_ART.has(fileName) ? objectTexture(fileName) : undefined;
}
