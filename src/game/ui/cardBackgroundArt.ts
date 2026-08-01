/**
 * カードの地に敷く、土地ごとの背景の解決。
 *
 * 置き場所と名前の規約は `src/assets/card_backgrounds/<土地のobject_defの識別子>.png` のみで、
 * コード側への登録は要らない。
 *
 * 絵はカード全面に敷くので、寸法・角の丸め・縁の透過はカードの絵と同じ規約に従う
 * （tools/comfyui/card_art.py の `--size card`。objectArt の CARD_ART_WIDTH 参照）。
 *
 * 一覧はimport.meta.globがビルド時に作る。実行時に総当たりで読みに行くと、絵をまだ用意していない
 * 土地のぶんだけ404が出るため。
 */
const FILES = import.meta.glob('../../assets/card_backgrounds/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** テクスチャキー → 画像のURL。用意されている絵だけが並ぶ。 */
export const CARD_BACKGROUND_ART: ReadonlyMap<string, string> = new Map(
  Object.entries(FILES).map(([path, url]) => [path.replace(/^.*\/(.+)\.png$/, 'card-background:$1'), url]),
);

/** 土地に応じたカードの背景のテクスチャキー。絵がまだ無い土地ではundefinedを返す。 */
export function cardBackgroundTexture(location: string): string | undefined {
  const key = `card-background:${location}`;
  return CARD_BACKGROUND_ART.has(key) ? key : undefined;
}
