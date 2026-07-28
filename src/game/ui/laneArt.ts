import separatorUrl from '../../assets/lane_separator.png';

/**
 * レーンの背景画像（レーン全面に敷く絵）の解決。
 *
 * 置き場所と名前の規約は、土地ごとに絵が変わるレーンが
 * `src/assets/lanes/<土地のobject_defの識別子>_<レーン>.png`、変わらないレーンが
 * `src/assets/lanes/<レーン>.png` のみで、コード側への登録は要らない。土地を先に置くのは、
 * 同じ土地の絵がファイル一覧で隣り合うようにするため。
 *
 * 絵はレーン高へ合わせて拡大縮小して敷くので原寸は問わないが、横方向は繰り返して並べるため、
 * 左右の端が繋がるように描く（CardLane参照）。
 *
 * 一覧はimport.meta.globがビルド時に作る。実行時に総当たりで読みに行くと、絵をまだ用意していない
 * 土地のぶんだけ404が出るため。
 */
const FILES = import.meta.glob('../../assets/lanes/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** 土地ごとに背景が変わるレーン。値はそのままファイル名の接尾辞。 */
export type LocationLane = 'fixture' | 'item';

/** ハンドレーンの背景のテクスチャキー（プレイヤーの手なので土地によらない）。 */
export const HAND_LANE_TEXTURE = 'lane:hand';

/**
 * レーンの区切りに敷く帯のテクスチャキー。絵は中央半分だけが区切りそのもので、上下1/4ずつは
 * 隣のレーンへかぶせる前提で描かれている（PlayScreenLayout.buildLaneSeparators参照）。
 */
export const LANE_SEPARATOR_TEXTURE = 'lane:separator';

/** テクスチャキー → 画像のURL。用意されている絵だけが並ぶ。 */
export const LANE_ART: ReadonlyMap<string, string> = new Map([
  ...Object.entries(FILES).map(([path, url]): [string, string] => [
    path.replace(/^.*\/(.+)\.png$/, 'lane:$1'),
    url,
  ]),
  [LANE_SEPARATOR_TEXTURE, separatorUrl],
]);

/**
 * 土地に応じたレーンの背景のテクスチャキー。絵がまだ無い土地ではundefinedを返し、呼び出し側は
 * 単色の背景板へ落とす。
 */
export function laneTexture(lane: LocationLane, location: string): string | undefined {
  const key = `lane:${location}_${lane}`;
  return LANE_ART.has(key) ? key : undefined;
}
