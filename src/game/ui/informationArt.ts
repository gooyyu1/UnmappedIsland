import backgroundUrl from '../../assets/information_background.png';

/**
 * 情報エリア（フィールドエリアの左／上）の背景画像。開いた本のページで、フィールドエリア側の端に
 * 表紙の縁と、その外へ落ちる影（透過）が描かれている。
 *
 * 絵は9patchとして敷く（Phaserの NineSlice）。四隅と縁は原寸のまま、中央の紙だけが引き伸ばされる
 * ので、1枚で任意の大きさを賄える。向きごとの絵も要らない（縦型は90度回して使う）。
 */
export const INFORMATION_BACKGROUND = 'information:background';

/** 絵の縁（表紙・小口・影）の幅。9patchで引き伸ばさない範囲であり、u単位でもある。 */
export const INFORMATION_BORDER_PX = 50;

/**
 * フィールドエリアへ食い込ませる幅。絵のこの範囲は透過のグラデーションで、ページがフィールドエリアへ
 * 落とす影にあたる（page_art.py の fade）。
 */
export const INFORMATION_OVERLAP_PX = 12;

/**
 * 情報エリアの各辺から、中身を置ける範囲（紙の内側）までの距離（u）。
 *
 * 9patchの縁は画面の大きさによらず一定なので、どちらもuでそのまま扱える。
 */
export const INFORMATION_PAPER_INSET = {
  /** フィールドエリア側の辺（横型は右・縦型は下）。縁の幅から、食い込ませる分を引いた残り。 */
  field: INFORMATION_BORDER_PX - INFORMATION_OVERLAP_PX,
  /** それ以外の辺（横型は上下・縦型は左右）。表紙の縁に載らない程度の余白。 */
  edge: 24,
};

/** テクスチャキー → 画像のURL。 */
export const INFORMATION_ART: ReadonlyMap<string, string> = new Map([
  [INFORMATION_BACKGROUND, backgroundUrl],
]);
