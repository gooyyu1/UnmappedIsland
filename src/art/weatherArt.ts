/**
 * 天候の絵（状況エリアに敷く空の絵）の解決。
 *
 * 置き場所と名前の規約は `src/assets/weather/<天気の識別子>.png` のみで、コード側への登録は要らない。
 * 一覧はimport.meta.globがビルド時に作る（絵をまだ用意していない天気のぶんだけ404が出るのを避ける、
 * backgroundArt参照）。
 *
 * **1枚の絵を縦型・横型それぞれの枠へcoverで敷く**ので、切り出される範囲は向きによって大きく違う。
 * 主題（太陽・雲）は絵の右上へ寄せて描く——載せる日時と天候名がその位置を避けている
 * （ScreenLayout.md 5節 状況エリア）。
 */
const FILES = import.meta.glob('../assets/weather/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** テクスチャキー → 画像のURL。用意されている絵だけが並ぶ。 */
export const WEATHER_ART: ReadonlyMap<string, string> = new Map(
  Object.entries(FILES).map(([path, url]) => [path.replace(/^.*\/(.+)\.png$/, 'weather:$1'), url]),
);

/**
 * 天気に応じた空の絵のテクスチャキー。絵がまだ無い天気ではundefinedを返し、呼び出し側は
 * 単色の背景板へ落とす（絵は少しずつ増える前提なので、混ざった状態を正常とする）。
 */
export function weatherTexture(weather: string | undefined): string | undefined {
  if (weather === undefined) return undefined;
  const key = `weather:${weather}`;
  return WEATHER_ART.has(key) ? key : undefined;
}
