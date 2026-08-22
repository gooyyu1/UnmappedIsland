import type { Localization } from '../../locale/Localization';
import type { CardContent } from '../ui/Card';

/**
 * キャラクタの絵（`src/assets/objects/<識別子>.png`、objectArt.ts）が用意されるまでの代替アイコン。
 * 選択肢が絵無しで全部同じ姿になるのを避けるための繋ぎで、絵が入れば不要になる。
 *
 * 表に無いキャラクタが出ないことは tests/world-codex/charactersYaml.test.ts が見張る。
 */
const PLACEHOLDER_ICONS: ReadonlyMap<string, string> = new Map([
  ['farmer', '🧑‍🌾'],
  ['engineer', '🧑‍🔧'],
  ['captain', '🧑‍✈️'],
  ['medic', '🧑‍⚕️'],
]);

/** 未知の識別子（旧セーブ）でも一覧を開けるようにするための、姿の分からないキャラクタの代役。 */
const UNKNOWN_CHARACTER_ICON = '🧍';

/**
 * その型あての代役アイコン（用意していない型ではundefined）。札の見た目（cardLooks.iconOf）が、
 * 種別ごとの代役より先に引く——同じ種別の中で見分けたい型だけが、自分の姿を名乗る。
 */
export function placeholderIconOf(objectDefName: string): string | undefined {
  return PLACEHOLDER_ICONS.get(objectDefName);
}

export function characterIcon(characterDefName: string): string {
  return placeholderIconOf(characterDefName) ?? UNKNOWN_CHARACTER_ICON;
}

/**
 * 開始画面（キャラクター選択・セーブスロット一覧）で出す、キャラクタ1人の札の内容。**インスタンスを
 * 持たない姿**なので、値のバーも印も持たない（プレイ中のポートレイトはcardLooks.contentOfが作る）。
 * 絵が無いあいだ絵文字で代用するのはCard側の役目。
 */
export function characterCardContent(characterDefName: string, locale: Localization): CardContent {
  return {
    icon: characterIcon(characterDefName),
    name: locale.object(characterDefName).displayName,
    art: characterDefName,
    kind: 'character',
  };
}
