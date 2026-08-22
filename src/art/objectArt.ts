import { addPackArt } from './packArt';

/**
 * object_defごとの絵の解決。
 *
 * 置き場所と名前の規約は `src/assets/objects/<object_defの識別子>.png` のみで、コード側への登録は
 * 要らない。識別子はCodex全体で一意（objectNamesは単一のレジストリ）なので、種別のプレフィックスも
 * サフィックスも付けない——アイテムから設置物へ移しても、ファイル名を変えずに済むようにするため。
 * 唯一の例外が、載り方が違う絵を表す接尾辞（MULTIPLY_SUFFIX）。
 *
 * 同梱ぶんの一覧はimport.meta.globがビルド時に作る。実行時に総当たりで読みに行くと、絵をまだ
 * 用意していないobject_defのぶんだけ404が出るため。アセットパックのぶんは起動時に重ねる
 * （installPackObjectArt、AssetPack.md 4節）。
 */
const FILES = import.meta.glob('../assets/objects/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/**
 * object_defの識別子 → 画像のURL。同梱ぶんを土台に、起動時にアセットパックのぶんが重なる。
 * 重なった後は変わらない。
 */
const ART = new Map<string, string>(
  Object.entries(FILES).map(([path, url]) => [path.replace(/^.*\/(.+)\.png$/, '$1'), url]),
);

/**
 * object_defの識別子 → 画像のURL。**鍵はテクスチャキーではない**ので、他の在庫表（BACKGROUND_ART
 * ほか）と同じ`*_ART`とは名乗らない——読み込む側はobjectTextureを掛けてから鍵にする（artFiles）。
 */
export const ART_BY_OBJECT_NAME: ReadonlyMap<string, string> = ART;

/** アセットパックの型の絵を在庫表へ重ねる（起動時に1回、installAssetPackから）。 */
export function installPackObjectArt(art: ReadonlyMap<string, string>, packName: string): void {
  addPackArt(ART, art, packName, '型の絵');
}

/**
 * 絵が描かれているときのカードの幅（tools/comfyui/card_art.py の CARD_WIDTH と同じ値）。
 *
 * 絵はこの幅のカードに載せる前提で作られていて、画像そのものの寸法は絵ごとに違う。小さい物は小さい
 * 画像で持ち、カードの中央へ置かれる。表示側は寸法を気にせず、常に cardWidth / この値 倍で描けばよい。
 */
export const CARD_ART_WIDTH = 410;

/**
 * カードに出す絵の名前。`art_by_stage`（GameElementDefinition.md 6.4節）の段が接尾辞を宣言していれば
 * `<objectName>_<接尾辞>` を、そのファイルがまだ無ければ型自身の絵（objectName）を返す。
 *
 * ファイルの有無を見るのは、絵を描くのと文法を宣言するのを別々の時に行えるようにするため——先に
 * 宣言しても、絵が入るまでは今まで通りの姿で出る（`_multiply` と同じ既定動作）。
 */
export function artNameFor(objectName: string, stageArtSuffix: string | undefined): string {
  if (stageArtSuffix === undefined) return objectName;
  const stageArtName = `${objectName}_${stageArtSuffix}`;
  return ART_BY_OBJECT_NAME.has(stageArtName) ? stageArtName : objectName;
}

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
  return ART_BY_OBJECT_NAME.has(fileName) ? objectTexture(fileName) : undefined;
}
