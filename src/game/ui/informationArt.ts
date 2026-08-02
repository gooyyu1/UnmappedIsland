import backgroundUrl from '../../assets/information_background.png';

/**
 * 情報エリア（フィールドエリアの左／上）の背景画像。開いた本のページで、フィールドエリア側の端に
 * 表紙の縁と、その外へ落ちる影（透過）が描かれている。
 *
 * 絵は9patchとして敷く（Phaserの NineSlice）。四隅と縁は絵から原寸で切り出され、中央の紙だけが
 * 引き伸ばされるので、1枚で任意の大きさを賄える。向きごとの絵も要らない（縦型は90度回して使う）。
 *
 * 絵は**1ピクセル = 1u**（短辺1080のときの原寸）で描かれている。9patchの縁は原寸で切り出される以上、
 * 縁の太さを画面の大きさによらず一定のuに保つには、絵全体をu倍して敷くしかない
 * （PlayScene.buildInformationArea）。
 *
 * 下の2つは絵が従うべき寸法であって、絵から測った値ではない。絵を作り直すときは、この寸法に合わせて
 * 切り出す（recipes/information_background.json の crop / fade）。
 */
export const INFORMATION_BACKGROUND = 'information:background';

/** 絵のフィールドエリア側の縁（小口・表紙・影）の幅。9patchで引き伸ばさない範囲。 */
export const INFORMATION_BORDER_PX = 48;

/**
 * 縁のうち、外側の影（透過のグラデーション）の幅。この分だけフィールドエリアへ食い込ませることで、
 * 影が全部フィールドエリアの上に落ちる。
 */
export const INFORMATION_OVERLAP_PX = 16;

/**
 * 情報エリアの各辺から、中身を置ける範囲（紙の内側）までの距離（u）。
 *
 * 縁は画面の大きさによらず一定のuになるので、どちらもuでそのまま扱える。
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
