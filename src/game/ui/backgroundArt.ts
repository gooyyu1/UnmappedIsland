/**
 * 背景の絵（レーンの全面に敷くもの・設置物のカードの地に敷くもの）の解決。
 *
 * 置き場所と名前の規約は、土地ごとに絵が変わるものが
 * `src/assets/backgrounds/<土地のobject_defの識別子>_<用途>.png`、変わらないものが
 * `src/assets/backgrounds/<用途>.png` のみで、コード側への登録は要らない。土地を先に置くのは、
 * 同じ土地の絵がファイル一覧で隣り合うようにするため。
 *
 * **土地ごとの背景は用途をまたいで対で必要になる**（土地を1つ足すと、レーン2枚とカード1枚が
 * 同時に要る）ので、用途ごとにディレクトリを分けず1つに集める。用途はファイル名の接尾辞が表す。
 *
 * 一覧はimport.meta.globがビルド時に作る。実行時に総当たりで読みに行くと、絵をまだ用意していない
 * 土地のぶんだけ404が出るため。
 */
const FILES = import.meta.glob('../../assets/backgrounds/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** 土地ごとに背景が変わるレーン。値はそのままファイル名の接尾辞。 */
export type LocationLane = 'fixture' | 'item';

/** 設置物のカードの地に敷く絵のファイル名の接尾辞。 */
const CARD_BACKGROUND_SUFFIX = 'card_background';

/** ハンドレーンの背景のテクスチャキー（プレイヤーの手なので土地によらない）。 */
export const HAND_LANE_TEXTURE = 'background:hand';

/** テクスチャキー → 画像のURL。用意されている絵だけが並ぶ。 */
export const BACKGROUND_ART: ReadonlyMap<string, string> = new Map(
  Object.entries(FILES).map(([path, url]) => [path.replace(/^.*\/(.+)\.png$/, 'background:$1'), url]),
);

/**
 * 土地に応じたレーンの背景のテクスチャキー。絵がまだ無い土地ではundefinedを返し、呼び出し側は
 * 単色の背景板へ落とす。
 */
export function laneTexture(lane: LocationLane, location: string): string | undefined {
  return textureOf(`${location}_${lane}`);
}

/** 土地に応じたカードの背景のテクスチャキー。絵がまだ無い土地ではundefinedを返す。 */
export function cardBackgroundTexture(location: string): string | undefined {
  return textureOf(`${location}_${CARD_BACKGROUND_SUFFIX}`);
}

/**
 * 1つの土地に紐づく背景のテクスチャキー（用意されている絵だけ、最大3枚）。
 * 土地の絵の遅延ロード（locationArt）が「その土地のぶん」をまとめて引くために使う。
 */
export function locationBackgroundTextures(location: string): readonly string[] {
  return [`${location}_fixture`, `${location}_item`, `${location}_${CARD_BACKGROUND_SUFFIX}`]
    .map((fileName) => `background:${fileName}`)
    .filter((key) => BACKGROUND_ART.has(key));
}

function textureOf(fileName: string): string | undefined {
  const key = `background:${fileName}`;
  return BACKGROUND_ART.has(key) ? key : undefined;
}
