/**
 * キャラクタの絵（`src/assets/objects/<識別子>.png`、objectArt.ts）が用意されるまでの代替アイコン。
 * 選択肢が絵無しで全部同じ姿になるのを避けるための繋ぎで、絵が入れば不要になる。
 *
 * 表に無いキャラクタが出ないことは tests/worldCodex/charactersYaml.test.ts が見張る。
 */
const PLACEHOLDER_ICONS: ReadonlyMap<string, string> = new Map([
  ['farmer', '🧑‍🌾'],
  ['engineer', '🧑‍🔧'],
  ['captain', '🧑‍✈️'],
  ['medic', '🧑‍⚕️'],
]);

/** 未知の識別子（旧セーブ）でも一覧を開けるようにするための、姿の分からないキャラクタの代役。 */
const UNKNOWN_CHARACTER_ICON = '🧍';

export function characterIcon(characterDefName: string): string {
  return PLACEHOLDER_ICONS.get(characterDefName) ?? UNKNOWN_CHARACTER_ICON;
}
