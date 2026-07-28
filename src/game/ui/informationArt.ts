import landscapeUrl from '../../assets/information_background_landscape.png';
import portraitUrl from '../../assets/information_background_portrait.png';

/**
 * 情報エリア（フィールドエリアの左／上）の背景画像。開いた本のページで、フィールドエリア側の端に
 * 表紙の縁が描かれている。
 *
 * 絵はフィールドエリアへ食い込ませて置く。縁がフィールドエリアに重なることで、ページが手前に
 * 重ねられているように見せる（PlayScene.buildInformationArea参照）。
 */
export const INFORMATION_BACKGROUND = {
  landscape: 'information:landscape',
  portrait: 'information:portrait',
} as const;

/**
 * フィールドエリアへ食い込ませる幅（絵の側のピクセル数）。絵のこの範囲は透過のグラデーションで、
 * ページがフィールドエリアへ落とす影にあたる。
 */
export const INFORMATION_OVERLAP_PX = 32;

/** 絵の一辺（正方形）と、フィールドエリア側の辺から紙の内側が始まるまでの幅（絵の側のピクセル数）。 */
const IMAGE_SIZE_PX = 1024;
const PAPER_MARGIN_PX = 56;

/**
 * 情報エリアのフィールドエリア側の辺から、紙の内側までの距離（u）。この内側にだけ中身を置ける。
 *
 * 絵は情報エリアの短辺いっぱい（横型は画面高、縦型は画面幅）へ拡大縮小され、その短辺は常に1080uなので、
 * 画面の大きさによらず一定の値になる。
 */
export const INFORMATION_PAPER_INSET = ((PAPER_MARGIN_PX - INFORMATION_OVERLAP_PX) * 1080) / IMAGE_SIZE_PX;

/** テクスチャキー → 画像のURL。 */
export const INFORMATION_ART: ReadonlyMap<string, string> = new Map([
  [INFORMATION_BACKGROUND.landscape, landscapeUrl],
  [INFORMATION_BACKGROUND.portrait, portraitUrl],
]);
