import handUrl from '../../assets/lanes/hand.png';

/**
 * レーンの背景画像（レーン全面に敷く絵）の解決。
 *
 * 置き場所と名前の規約は、土地ごとに絵が変わるレーンが `src/assets/lanes/<レーン>/<土地の
 * object_defの識別子>.png`、変わらないレーンが `src/assets/lanes/<レーン>.png` で、コード側への
 * 登録は要らない。絵はレーン高へ合わせて拡大縮小して敷くので原寸は問わないが、横方向は繰り返して
 * 並べるため、左右の端が繋がるように描く（CardLane参照）。
 *
 * 一覧はimport.meta.globがビルド時に作る。実行時に総当たりで読みに行くと、絵をまだ用意していない
 * 土地のぶんだけ404が出るため。
 */
const FILES = import.meta.glob('../../assets/lanes/*/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** 土地ごとに背景が変わるレーン。値はそのまま `src/assets/lanes/` 直下のディレクトリ名。 */
export type LocationLane = 'location' | 'field_item';

/** ハンドレーンの背景のテクスチャキー（プレイヤーの手なので土地によらない）。 */
export const HAND_LANE_TEXTURE = 'lane:hand';

/** テクスチャキー → 画像のURL。用意されている絵だけが並ぶ。 */
export const LANE_ART: ReadonlyMap<string, string> = new Map([
  ...Object.entries(FILES).map(([path, url]): [string, string] => [
    path.replace(/^.*\/(.+)\/(.+)\.png$/, 'lane:$1:$2'),
    url,
  ]),
  [HAND_LANE_TEXTURE, handUrl],
]);

/**
 * 土地に応じたレーンの背景のテクスチャキー。絵がまだ無い土地ではundefinedを返し、呼び出し側は
 * 単色の背景板へ落とす。
 */
export function locationLaneTexture(lane: LocationLane, location: string): string | undefined {
  const key = `lane:${lane}:${location}`;
  return LANE_ART.has(key) ? key : undefined;
}
