/**
 * バーのアイコンボタン1つ。絵があればそれを、無ければ絵文字を置く（iconArt参照）。
 *
 * **絵の名前は画面が名指しするとは限らない**——フィルターのボタンはワールドの宣言が名乗る
 * （`card_filters`の`id`、ScreenLayout.md 8.1.3節）。
 */
export interface BarIcon {
  readonly art?: string;
  readonly icon: string;
}

/** メニューだけは押したときの行き先があるため、判別できるよう切り出す。 */
export const MENU_ICON: BarIcon = { icon: '☰' };

/**
 * オプションバーに並ぶボタン（ScreenLayout.md 6節）。**横型のバーの高さもここから出す**
 * （PlayScreenLayout）ので、増やせば縦積みの寸法も一緒に動く。
 */
export const OPTION_ICONS: readonly BarIcon[] = [
  { art: 'settings', icon: '⚙️' },
  { art: 'codex', icon: '📖' },
  { art: 'diary', icon: '📓' },
  MENU_ICON,
];
