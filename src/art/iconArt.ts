/**
 * UIのアイコンの絵（地図・装備・怪我・レシピのボタン、状況アイコン）の解決。
 *
 * 置き場所と名前の規約は `src/assets/icons/<アイコンの識別子>.png` のみで、コード側への登録は
 * 要らない。一覧はimport.meta.globがビルド時に作る（実行時に総当たりで読みに行くと、絵をまだ
 * 用意していないぶんだけ404が出るため。backgroundArt参照）。
 *
 * **識別子を決めるのはボタンとそれ以外で違う。** 画面に固定で置かれるボタンはUIが決めるので
 * ICON_NAMESに並ぶが、状況アイコンは段の`situation`が名乗る（docs/ui/ScreenLayout.md 4.1.1節）ので、
 * 何が来るかをここでは知らない。
 */
const FILES = import.meta.glob('../assets/icons/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/**
 * 画面が固定で置くボタンの識別子。ここにも段の`situation`にも無い名前のファイルは黙って使われない
 * ままになるので、実在するかどうかは自動テスト（tests/art/iconArt.test.ts）が検査する。
 */
export const ICON_NAMES = [
  'map',
  'equipment',
  'injury',
  'recipe',
  'settings',
  'codex',
  'diary',
  'filter_all',
  'filter_cook',
  'filter_water',
  'filter_craft',
  'filter_fun',
] as const;

export type IconName = (typeof ICON_NAMES)[number];

/** テクスチャキー → 画像のURL。用意されている絵だけが並ぶ。 */
export const ICON_ART: ReadonlyMap<string, string> = new Map(
  Object.entries(FILES).map(([path, url]) => [path.replace(/^.*\/(.+)\.png$/, 'icon:$1'), url]),
);

/**
 * アイコンのテクスチャキー。絵がまだ無いものはundefinedを返し、呼び出し側は絵文字で代用する
 * （絵は少しずつ増える前提なので、絵と絵文字が混ざった状態を正常とする）。
 *
 * **識別子はIconNameに限らない**——状況アイコンの識別子はワールドの宣言から来るので、コードの
 * 列挙には無い（モジュールの説明参照）。
 */
export function iconTexture(name: string): string | undefined {
  const key = `icon:${name}`;
  return ICON_ART.has(key) ? key : undefined;
}
