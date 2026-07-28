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
 * フィールドエリアへ食い込ませる幅（絵の側のピクセル数）。絵のこの範囲だけが表紙の縁で、
 * 残りはページ。
 */
export const INFORMATION_OVERLAP_PX = 32;

/** テクスチャキー → 画像のURL。 */
export const INFORMATION_ART: ReadonlyMap<string, string> = new Map([
  [INFORMATION_BACKGROUND.landscape, landscapeUrl],
  [INFORMATION_BACKGROUND.portrait, portraitUrl],
]);
