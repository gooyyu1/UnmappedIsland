/**
 * 背景の絵（レーンの全面に敷くもの・カードの地に敷くもの）の解決。
 *
 * 置き場所と名前の規約は `src/assets/backgrounds/<持ち主>_<スロット名>_<用途>.png` のみで、コード側への
 * 登録は要らない。用途は敷く場所（`lane` / `card`）で、それ以外は**すべてワールド側の言葉**。
 *
 * **どのスロットの絵かを、名前が言う。** 「設置物レーンには土地の眺め」「怪我のカードには本人の肌」と
 * いった対応をコードが持つと、絵を1枚足すたびにコードを触ることになり、絵の一覧を見ても何に使われる
 * のか分からない。名前がスロットを名乗れば、画面側の規則は「そのカードが今在るスロットの絵を敷く」の
 * 1つで済む。
 *
 * 持ち主によらない絵は `<スロット名>_<用途>.png` に置き、持ち主ごとの絵が無いときの受け皿になる
 * （手はプレイヤー自身のものなので、キャラクタごとに描き分けていない）。
 *
 * 一覧はimport.meta.globがビルド時に作る。実行時に総当たりで読みに行くと、絵をまだ用意していない
 * スロットのぶんだけ404が出るため。
 */
const FILES = import.meta.glob('../../assets/backgrounds/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** 背景を引く先——そのカード・そのレーンが映しているスロット。 */
export interface SlotRef {
  /** スロットを持つobject_defの識別子（土地・キャラクタ・動物）。 */
  readonly owner: string;
  /** スロット名（`fixtures`・`injuries`など、ワールド側の宣言そのもの）。 */
  readonly slot: string;
}

/** 敷く場所。そのままファイル名の末尾になる。 */
type Use = 'lane' | 'card';

/** テクスチャキー → 画像のURL。用意されている絵だけが並ぶ。 */
export const BACKGROUND_ART: ReadonlyMap<string, string> = new Map(
  Object.entries(FILES).map(([path, url]) => [path.replace(/^.*\/(.+)\.png$/, 'background:$1'), url]),
);

/** レーンの全面に敷く絵。用意されていなければundefinedを返し、呼び出し側は単色の背景板へ落とす。 */
export function laneTexture(at: SlotRef): string | undefined {
  return textureOf(at, 'lane');
}

/** カードの地に敷く絵。用意されていなければundefinedを返し、呼び出し側は紙のままにする。 */
export function cardBackgroundTexture(at: SlotRef): string | undefined {
  return textureOf(at, 'card');
}

/**
 * 1つの持ち主に紐づく背景のテクスチャキー。土地の絵の遅延ロード（locationArt）が「その土地のぶん」を
 * まとめて引くために使う。用途もスロットも問わないので、絵を足しても数え直す場所は無い。
 */
export function backgroundTexturesOf(owner: string): readonly string[] {
  return [...BACKGROUND_ART.keys()].filter((key) => ownerOf(key) === owner);
}

/** 持ち主ごとの絵、無ければスロット共通の絵。 */
function textureOf(at: SlotRef, use: Use): string | undefined {
  return found(`${at.owner}_${at.slot}_${use}`) ?? found(`${at.slot}_${use}`);
}

function found(fileName: string): string | undefined {
  const key = `background:${fileName}`;
  return BACKGROUND_ART.has(key) ? key : undefined;
}

/**
 * テクスチャキーから持ち主を読み取る（持ち主によらない絵ではundefined）。スロット名にも用途にも
 * `_` は入らないので、末尾2つを外した残りが持ち主になる。
 */
function ownerOf(key: string): string | undefined {
  const parts = key.replace(/^background:/, '').split('_');
  return parts.length > 2 ? parts.slice(0, -2).join('_') : undefined;
}
