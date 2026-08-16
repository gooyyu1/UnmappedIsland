/**
 * UIのアイコンの絵（地図・装備・怪我・レシピのボタン）の解決。
 *
 * 置き場所と名前の規約は `src/assets/icons/<アイコンの識別子>.png` のみで、コード側への登録は
 * 要らない。一覧はimport.meta.globがビルド時に作る（実行時に総当たりで読みに行くと、絵をまだ
 * 用意していないぶんだけ404が出るため。backgroundArt参照）。
 *
 * カードの絵と違い、識別子はドメインではなくUIが決める。これらは特定のobject_defではなく、
 * 画面に固定で置かれるボタンだから。
 */
const FILES = import.meta.glob('./icons/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/**
 * 絵を置けるアイコンの識別子。ここに無い名前のファイルは黙って使われないままになるので、
 * 実在するかどうかは自動テスト（tests/assets/iconArt.test.ts）が検査する。
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
 */
export function iconTexture(name: IconName): string | undefined {
  const key = `icon:${name}`;
  return ICON_ART.has(key) ? key : undefined;
}
