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

export function characterIcon(characterDefName: string): string {
  return PLACEHOLDER_ICONS.get(characterDefName) ?? UNKNOWN_CHARACTER_ICON;
}

/**
 * キャラクタ1人をカードで見せるときの内容。開始画面（キャラクター選択・セーブスロット一覧）と
 * プレイ中のポートレイトで、同じ札が同じ姿で出るようにするための1か所。
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
